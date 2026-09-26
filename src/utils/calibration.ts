// One-point GPS calibration.
//
// The user sets the phone on a known control point; the app averages its GPS
// for a while and works out how far off the phone is (the "shift"). That shift
// is added to every structure position recorded afterwards, until the user
// recalibrates (same point or another one) or turns calibration off.
//
// Phone GPS error drifts as satellites move and as you walk around, so a
// calibration is only trusted for a while and near its point — see staleness().
// Horizontal only: phone heights are too rough to be worth correcting.

import {CoordinateSystem} from '../data/coordinateSystems';
import {projectPoint, unprojectPoint, isGeographic} from './projection';

export type ControlPoint = {
  id: string;
  name: string;
  /** In the job's coordinate system and units (latitude for a geographic system) */
  northing: number;
  /** In the job's coordinate system and units (longitude for a geographic system) */
  easting: number;
};

export type GpsCalibration = {
  id: string;
  controlPointId: string;
  pointName: string;
  createdAt: string;
  /** How many GPS readings were averaged, and their average reported accuracy (m) */
  samples: number;
  meanAccuracy: number;
  /** Averaged phone position on the point */
  measuredLat: number;
  measuredLon: number;
  /** The control point's true position */
  knownLat: number;
  knownLon: number;
  /** Shift added to raw GPS (degrees) */
  dLat: number;
  dLon: number;
  /** Size of the shift in metres (for display) */
  shiftMetres: number;
};

export type GpsSample = {latitude: number; longitude: number; accuracy: number | null};

/** Readings worse than this are ignored while calibrating */
export const MAX_SAMPLE_ACCURACY_M = 25;
/** How long to average for, and the fewest readings accepted */
export const CALIBRATION_SECONDS = 45;
export const MIN_SAMPLES = 10;
/** A shift bigger than this is probably a wrong point or coordinate system */
export const LARGE_SHIFT_M = 30;
/** Past these, suggest recalibrating */
export const STALE_MINUTES = 60;
export const STALE_DISTANCE_M = 300; // ≈ 1,000 ft

/** Straight-line distance between two lat/longs, metres */
export function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Weighted average of the readings (better accuracy counts more) */
export function averageSamples(samples: GpsSample[]): {latitude: number; longitude: number; meanAccuracy: number} | null {
  const good = samples.filter(s => s.accuracy === null || s.accuracy <= MAX_SAMPLE_ACCURACY_M);
  if (good.length === 0) return null;
  let wSum = 0;
  let lat = 0;
  let lon = 0;
  let acc = 0;
  for (const s of good) {
    const a = Math.max(1, s.accuracy ?? 10);
    const w = 1 / (a * a);
    wSum += w;
    lat += s.latitude * w;
    lon += s.longitude * w;
    acc += a;
  }
  return {latitude: lat / wSum, longitude: lon / wSum, meanAccuracy: acc / good.length};
}

/** Work out the calibration from a control point and the readings taken on it */
export function computeCalibration(
  point: ControlPoint,
  samples: GpsSample[],
  cs: CoordinateSystem,
  id: string,
  now = new Date(),
): GpsCalibration {
  const known = unprojectPoint(point.northing, point.easting, cs);
  if (!known) throw new Error("The control point's coordinates can't be converted in this job's coordinate system.");
  const avg = averageSamples(samples);
  if (!avg) throw new Error('No usable GPS readings — move to open sky and try again.');
  return {
    id,
    controlPointId: point.id,
    pointName: point.name,
    createdAt: now.toISOString(),
    samples: samples.filter(s => s.accuracy === null || s.accuracy <= MAX_SAMPLE_ACCURACY_M).length,
    meanAccuracy: avg.meanAccuracy,
    measuredLat: avg.latitude,
    measuredLon: avg.longitude,
    knownLat: known.latitude,
    knownLon: known.longitude,
    dLat: known.latitude - avg.latitude,
    dLon: known.longitude - avg.longitude,
    shiftMetres: distanceMetres(avg.latitude, avg.longitude, known.latitude, known.longitude),
  };
}

/** Apply a calibration to a raw GPS position */
export function applyCalibration(
  latitude: number,
  longitude: number,
  cal: GpsCalibration | null | undefined,
): {latitude: number; longitude: number} {
  if (!cal || (!latitude && !longitude)) return {latitude, longitude};
  return {latitude: latitude + cal.dLat, longitude: longitude + cal.dLon};
}

/**
 * The shift in the job's coordinates, e.g. "3.42 ft N, 1.10 ft W (3.59 ft)".
 * Uses metres for a geographic (lat/long) system.
 */
export function describeShift(cal: GpsCalibration, cs: CoordinateSystem): string {
  if (isGeographic(cs)) return `${cal.shiftMetres.toFixed(2)} m`;
  const a = projectPoint(cal.measuredLat, cal.measuredLon, cs);
  const b = projectPoint(cal.knownLat, cal.knownLon, cs);
  const dN = parseFloat(b.northing) - parseFloat(a.northing);
  const dE = parseFloat(b.easting) - parseFloat(a.easting);
  if (!isFinite(dN) || !isFinite(dE)) return `${cal.shiftMetres.toFixed(2)} m`;
  const unit = cs.units === 'm' ? 'm' : 'ft';
  const total = Math.sqrt(dN * dN + dE * dE);
  return `${Math.abs(dN).toFixed(2)} ${unit} ${dN >= 0 ? 'N' : 'S'}, ${Math.abs(dE).toFixed(2)} ${unit} ${
    dE >= 0 ? 'E' : 'W'
  } (${total.toFixed(2)} ${unit})`;
}

/** Why the calibration may no longer be trustworthy, or null if it's fine */
export function staleness(
  cal: GpsCalibration,
  now = new Date(),
  here?: {latitude: number; longitude: number} | null,
): string | null {
  const minutes = (now.getTime() - new Date(cal.createdAt).getTime()) / 60000;
  if (minutes > STALE_MINUTES) return `Calibrated ${Math.round(minutes)} min ago — recalibrate`;
  if (here && (here.latitude || here.longitude)) {
    const d = distanceMetres(here.latitude, here.longitude, cal.knownLat, cal.knownLon);
    if (d > STALE_DISTANCE_M) return `${Math.round(d * 3.28084).toLocaleString()} ft from ${cal.pointName} — recalibrate`;
  }
  return null;
}

/** "12 min ago", "just now", "2 h ago" */
export function ageText(iso: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  return h < 48 ? `${h} h ago` : new Date(iso).toLocaleDateString();
}
