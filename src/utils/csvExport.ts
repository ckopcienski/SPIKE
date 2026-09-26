import RNFS from 'react-native-fs';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {Job} from '../storage/storage';
import {projectPoint, coordinateHeaders} from './projection';
import {jobCoordinateSystem, jobLists} from '../storage/templates';
import {fieldColumns} from '../data/structureFields';
import {
  findZone,
  HORIZONTAL_DATUMS,
  VERTICAL_DATUMS,
} from '../data/coordinateSystems';
import {networkLabelOfType} from './structureTypes';

// Generate CSV content for a job
export function generateCSV(job: Job): string {
  const rows: string[] = [];

  // Coordinate system copied from the job's template (OH North, NAD83 / NAVD88 for older jobs)
  const cs = jobCoordinateSystem(job);
  const [northHeader, eastHeader] = coordinateHeaders(cs);
  const zoneName = findZone(cs.zoneId)?.label ?? cs.zoneId;
  const hDatum = HORIZONTAL_DATUMS.find(d => d.id === cs.horizontalDatum)?.short ?? cs.horizontalDatum;
  const vDatum = VERTICAL_DATUMS.find(d => d.id === cs.verticalDatum)?.short ?? cs.verticalDatum;
  // Added at the end of every row so existing column positions don't move
  const datumCells = [csvCell(zoneName), csvCell(hDatum), csvCell(vDatum)];
  // Optional structure fields (City, Station …) go after those, same reason
  const extraCols = fieldColumns(jobLists(job).structureFields);
  // Jobs that have used GPS calibration also get the control point each position was shifted to
  if ((job.calibrationHistory?.length ?? 0) > 0) {
    extraCols.push({header: 'GPS Calibrated At', value: (st: any) => st.calibrationPoint ?? ''});
  }

  // Header row
  rows.push(
    [
      'Job Name',
      'Job Number',
      'Network Type',
      'Crew',
      'Structure ID',
      'Type',
      'Street',
      'Rim Elevation (ft)',
      'Casting Size',
      'Structure Depth (ft)',
      northHeader,
      eastHeader,
      'DMS Coordinates',
      'Pipe Number',
      'Pipe Direction',
      'Pipe Size',
      'Pipe Material',
      'Depth Below Rim (ft)',
      'Notes',
      'Date Recorded',
      'Coordinate System',
      'Horizontal Datum',
      'Vertical Datum',
      // Optional structure fields that are on in the job's template
      ...extraCols.map(col => col.header),
    ].join(','),
  );

  // Data rows — one row per pipe
  for (const structure of job.structures) {
    const {northing: nStr, easting: eStr} = projectPoint(
      structure.latitude,
      structure.longitude,
      cs,
    );

    const castingDisplay = !structure.castingWidth?.trim()
      ? ''
      : structure.castingShape === 'round'
        ? `${structure.castingWidth}' round`
        : `${structure.castingWidth}' x ${structure.castingLength}' rect`;
    const network = networkLabelOfType(structure.type) || job.networkType || '';

    if (structure.pipes.length === 0) {
      // Structure with no pipes — still export a row
      rows.push(
        [
          csvCell(job.name),
          csvCell(job.jobNumber),
          csvCell(network),
          csvCell(job.crew),
          csvCell(structure.structureId),
          csvCell(structure.type),
          csvCell(structure.street),
          csvCell(structure.rimElevation),
          csvCell(castingDisplay),
          csvCell(structure.depth),
          csvCell(nStr),
          csvCell(eStr),
          csvCell(structure.dmsCoordinates),
          '',
          '',
          '',
          '',
          '',
          csvCell(structure.notes),
          csvCell(structure.createdAt),
          ...datumCells,
          ...extraCols.map(col => csvCell(col.value(structure))),
        ].join(','),
      );
    } else {
      structure.pipes.forEach((pipe, index) => {
        rows.push(
          [
            csvCell(job.name),
            csvCell(job.jobNumber),
            csvCell(network),
            csvCell(job.crew),
            csvCell(structure.structureId),
            csvCell(structure.type),
            csvCell(structure.street),
            csvCell(structure.rimElevation),
            csvCell(castingDisplay),
            csvCell(structure.depth),
            csvCell(nStr),
            csvCell(eStr),
            csvCell(structure.dmsCoordinates),
            String(index + 1),
            csvCell(pipe.direction),
            csvCell(pipe.size),
            csvCell(pipe.material),
            String(pipe.depthBelowRim),
            csvCell(structure.notes),
            csvCell(structure.createdAt),
            ...datumCells,
          ...extraCols.map(col => csvCell(col.value(structure))),
          ].join(','),
        );
      });
    }
  }

  return rows.join('\n');
}

function safeName(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_') || 'job';
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// Save the CSV to the phone's Downloads/SPIKE folder (visible in the Files app
// and over USB). Returns the location to show the user, e.g.
// "Downloads/SPIKE/Main_St_structures_2026-09-25_1430.csv".
export function csvFileName(job: Job): string {
  const base = job.jobNumber
    ? `${safeName(job.jobNumber)}_${safeName(job.name)}`
    : safeName(job.name);
  return `${base}_structures_${stamp()}.csv`;
}

// Write the CSV into a folder inside the app's cache and return its path
// (used for sharing, and as the source for saving to Downloads)
export async function writeCSVFile(job: Job, dir: string): Promise<string> {
  if (!(await RNFS.exists(dir))) await RNFS.mkdir(dir);
  const path = `${dir}/${csvFileName(job)}`;
  await RNFS.writeFile(path, generateCSV(job), 'utf8');
  return path;
}

export async function saveCSV(job: Job): Promise<string> {
  const tempPath = await writeCSVFile(job, RNFS.CachesDirectoryPath);
  const fileName = tempPath.split('/').pop()!;
  try {
    await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
      {name: fileName, parentFolder: 'SPIKE', mimeType: 'text/csv'},
      'Download',
      tempPath,
    );
  } finally {
    await RNFS.unlink(tempPath).catch(() => {});
  }
  return `Downloads/SPIKE/${fileName}`;
}

// Wrap a cell value safely for CSV
function csvCell(value: string | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}