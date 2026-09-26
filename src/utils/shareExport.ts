import {Alert} from 'react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import {Job} from '../storage/storage';
import {writeCSVFile} from './csvExport';
import {writePhotosZip, existingJobPhotos} from './photoExport';
import {writeReportFile} from './reportExport';
import {UserProfile} from '../storage/settings';

export type ShareWhat = 'csv' | 'photos' | 'both' | 'report';

// Temporary files handed to the share sheet live here. They're cleared at the
// start of the next share (the receiving app may still be reading them now).
const SHARE_DIR = `${RNFS.CachesDirectoryPath}/share`;

async function resetShareDir() {
  if (await RNFS.exists(SHARE_DIR)) {
    await RNFS.unlink(SHARE_DIR).catch(() => {});
  }
  await RNFS.mkdir(SHARE_DIR);
}

/** Build the file(s) and open Android's share sheet (email, Drive, Nearby Share, etc.) */
export async function shareJob(
  job: Job,
  what: ShareWhat,
  profile?: UserProfile, // shown as "Prepared by" on the PDF report
): Promise<void> {
  await resetShareDir();

  const files: string[] = [];
  const types: string[] = [];

  if (what === 'csv' || what === 'both') {
    files.push(await writeCSVFile(job, SHARE_DIR));
    types.push('text/csv');
  }
  if (what === 'photos' || what === 'both') {
    const zipped = await writePhotosZip(job, SHARE_DIR);
    files.push(zipped.path);
    types.push('application/zip');
  }
  if (what === 'report') {
    const report = await writeReportFile(job, SHARE_DIR, profile);
    files.push(report.path);
    types.push('application/pdf');
  }

  const title = job.jobNumber ? `${job.jobNumber} ${job.name}` : job.name;
  await Share.open({
    title: `Share ${title}`,
    subject: `${title} — SPIKE export`,
    urls: files.map(p => `file://${p}`),
    type: types.length === 1 ? types[0] : '*/*',
    failOnCancel: false,
  });
}

/**
 * Share button handler: asks what to share (skips the question if the job
 * has no photos) and shows an error message if something goes wrong.
 */
export async function promptShareJob(job: Job): Promise<void> {
  const run = async (what: ShareWhat) => {
    try {
      await shareJob(job, what);
    } catch (e: any) {
      Alert.alert('Share failed', e?.message || 'Could not share. Please try again.');
    }
  };

  const hasPhotos = (await existingJobPhotos(job)).length > 0;
  if (!hasPhotos) {
    await run('csv');
    return;
  }

  // Android shows at most three buttons; tap outside the box to cancel
  Alert.alert(
    'Share',
    'What would you like to share?',
    [
      {text: 'CSV + Photos', onPress: () => run('both')},
      {text: 'Photos (ZIP)', onPress: () => run('photos')},
      {text: 'CSV', onPress: () => run('csv')},
    ],
    {cancelable: true},
  );
}
