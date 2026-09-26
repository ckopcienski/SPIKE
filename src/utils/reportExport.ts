import RNFS from 'react-native-fs';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {Job} from '../storage/storage';
import {UserProfile, loadSettings} from '../storage/settings';
import {jobCoordinateSystem} from '../storage/templates';
import {buildReportPdf} from './pdfReport';

function safeName(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_') || 'job';
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Build the PDF report and write it into `dir` (inside the app). Returns its path. */
export async function writeReportFile(
  job: Job,
  dir: string,
  profile?: UserProfile,
): Promise<{path: string; fileName: string}> {
  const settings = await loadSettings();
  const base64 = await buildReportPdf(job, {
    coordinateSystem: jobCoordinateSystem(job),
    profile,
    networkColors: settings.networkColors,
  });
  if (!(await RNFS.exists(dir))) await RNFS.mkdir(dir);
  const base = job.jobNumber ? `${safeName(job.jobNumber)}_${safeName(job.name)}` : safeName(job.name);
  const fileName = `${base}_report_${stamp()}.pdf`;
  const path = `${dir}/${fileName}`;
  await RNFS.writeFile(path, base64, 'base64');
  return {path, fileName};
}

/** Save the PDF report to the phone's Downloads/SPIKE folder */
export async function exportReportPdf(
  job: Job,
  profile?: UserProfile,
): Promise<{fileName: string; location: string}> {
  const {path, fileName} = await writeReportFile(job, RNFS.CachesDirectoryPath, profile);
  try {
    await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
      {name: fileName, parentFolder: 'SPIKE', mimeType: 'application/pdf'},
      'Download',
      path,
    );
  } finally {
    await RNFS.unlink(path).catch(() => {});
  }
  return {fileName, location: 'Downloads/SPIKE'};
}
