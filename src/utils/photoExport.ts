import RNFS from 'react-native-fs';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {zip, NO_COMPRESSION} from 'react-native-zip-archive';
import {Job, getStructurePhotos} from '../storage/storage';

export type PhotoExportResult = {
  fileName: string;
  photoCount: number;
  /** Where the user can find it on the phone */
  location: string;
};

function safeName(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_') || 'job';
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Zips every photo in the job and saves the ZIP to the phone's
 * Downloads/SPIKE folder, where it can be copied off over USB,
 * opened in the Files app, or shared from there.
 */
/** Paths of all of the job's photo files that actually exist on disk */
export async function existingJobPhotos(job: Job): Promise<string[]> {
  const all = job.structures
    .flatMap(s => getStructurePhotos(s))
    .map(p => p.replace(/^file:\/\//, ''));
  const existing: string[] = [];
  for (const p of all) {
    if (await RNFS.exists(p)) existing.push(p);
  }
  return existing;
}

/**
 * Zip all of the job's photos into `dir` (inside the app's cache).
 * Returns the ZIP path and how many photos went in.
 */
export async function writePhotosZip(
  job: Job,
  dir: string,
): Promise<{path: string; fileName: string; photoCount: number}> {
  const existing = await existingJobPhotos(job);
  if (existing.length === 0) {
    throw new Error('This job has no photos to export yet.');
  }
  if (!(await RNFS.exists(dir))) await RNFS.mkdir(dir);
  const base = job.jobNumber ? `${safeName(job.jobNumber)}_${safeName(job.name)}` : safeName(job.name);
  const fileName = `${base}_photos_${stamp()}.zip`;
  const path = `${dir}/${fileName}`;
  // JPEGs are already compressed, so storing them is faster and just as small
  await zip(existing, path, NO_COMPRESSION);
  return {path, fileName, photoCount: existing.length};
}

export async function exportJobPhotosZip(job: Job): Promise<PhotoExportResult> {
  const {path: tempZip, fileName, photoCount} = await writePhotosZip(
    job,
    RNFS.CachesDirectoryPath,
  );

  try {
    await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
      {name: fileName, parentFolder: 'SPIKE', mimeType: 'application/zip'},
      'Download',
      tempZip,
    );
  } finally {
    if (await RNFS.exists(tempZip)) {
      await RNFS.unlink(tempZip).catch(() => {});
    }
  }

  return {
    fileName,
    photoCount,
    location: 'Downloads/SPIKE',
  };
}
