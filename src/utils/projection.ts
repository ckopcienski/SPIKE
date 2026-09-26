import proj4 from 'proj4';
import {
  CoordinateSystem,
  GEOGRAPHIC_ZONE_ID,
  HORIZONTAL_DATUMS,
  UNIT_OPTIONS,
  findZone,
} from '../data/coordinateSystems';

// Phone GPS positions (WGS 84 ≈ NAD83 at phone accuracy)
const GPS_SOURCE = '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs';

const converters = new Map<string, proj4.Converter>();
function converterFor(dest: string): proj4.Converter {
  let conv = converters.get(dest);
  if (!conv) {
    conv = proj4(GPS_SOURCE, dest);
    converters.set(dest, conv);
  }
  return conv;
}

/** The projection string to use for this coordinate system, or null if unavailable. */
export function projectionFor(cs: CoordinateSystem): string | null {
  const zone = findZone(cs.zoneId);
  if (!zone) return null;
  const family = HORIZONTAL_DATUMS.find(d => d.id === cs.horizontalDatum)?.family ?? 'nad83';
  return family === 'nad27' ? zone.proj27 : zone.proj83;
}

export function isGeographic(cs: CoordinateSystem): boolean {
  return cs.zoneId === GEOGRAPHIC_ZONE_ID;
}

/**
 * Convert a GPS position to the job's coordinate system.
 * Returns strings ready for the CSV, or blanks if there's no GPS fix or the
 * zone isn't defined for the chosen datum.
 */
export function projectPoint(
  latitude: number,
  longitude: number,
  cs: CoordinateSystem,
): {northing: string; easting: string} {
  const blank = {northing: '', easting: ''};
  if (!latitude && !longitude) return blank; // GPS unavailable
  const dest = projectionFor(cs);
  if (!dest) return blank;

  const [x, y] = converterFor(dest).forward([longitude, latitude]);
  if (!isFinite(x) || !isFinite(y)) return blank;

  if (isGeographic(cs)) {
    return {northing: y.toFixed(8), easting: x.toFixed(8)};
  }
  const unit = UNIT_OPTIONS.find(u => u.id === cs.units) ?? UNIT_OPTIONS[0];
  const decimals = unit.id === 'm' ? 3 : 2;
  return {
    northing: (y * unit.perMetre).toFixed(decimals),
    easting: (x * unit.perMetre).toFixed(decimals),
  };
}

/** CSV column headers for the two coordinate columns. */
export function coordinateHeaders(cs: CoordinateSystem): [string, string] {
  if (isGeographic(cs)) return ['Latitude (dec. deg)', 'Longitude (dec. deg)'];
  const unit = UNIT_OPTIONS.find(u => u.id === cs.units) ?? UNIT_OPTIONS[0];
  return [`Northing (${unit.short})`, `Easting (${unit.short})`];
}

/**
 * The reverse of projectPoint: a Northing/Easting in the job's coordinate
 * system (its units) → GPS latitude/longitude. For a geographic system,
 * northing = latitude and easting = longitude. Null if it can't be converted.
 */
export function unprojectPoint(
  northing: number,
  easting: number,
  cs: CoordinateSystem,
): {latitude: number; longitude: number} | null {
  if (!isFinite(northing) || !isFinite(easting)) return null;
  if (isGeographic(cs)) return {latitude: northing, longitude: easting};
  const dest = projectionFor(cs);
  if (!dest) return null;
  const unit = UNIT_OPTIONS.find(u => u.id === cs.units) ?? UNIT_OPTIONS[0];
  const [lon, lat] = converterFor(dest).inverse([easting / unit.perMetre, northing / unit.perMetre]);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  return {latitude: lat, longitude: lon};
}

/** Unit label for Northing/Easting in this coordinate system, e.g. "US ft" */
export function coordinateUnitShort(cs: CoordinateSystem): string {
  if (isGeographic(cs)) return '°';
  return (UNIT_OPTIONS.find(u => u.id === cs.units) ?? UNIT_OPTIONS[0]).short;
}
