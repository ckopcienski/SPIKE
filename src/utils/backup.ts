import RNFS from 'react-native-fs';
import ReactNativeBlobUtil from 'react-native-blob-util';
import Share from 'react-native-share';
import {zip, unzip, NO_COMPRESSION} from 'react-native-zip-archive';
import {pick, keepLocalCopy, types, errorCodes, isErrorWithCode} from '@react-native-documents/picker';
import {Job, Structure, SPIKE_DIR, loadJob, saveJob, initStorage} from '../storage/storage';
import {JobTemplate, loadSavedTemplates, replaceSavedTemplates} from '../storage/templates';
import {AppSettings, loadSettings} from '../storage/settings';

// ─── What's in a backup ─────────────────────────────────────────────────────
// SPIKE_backup_2026-09-26_1402.zip
//   _backup/manifest.json    app, format version, date, job count
//   _backup/templates.json   saved templates (not the built-in one)
//   _backup/settings.json    profile, network colours, dark mode …
//   _backup/profile-photo.jpg (if there is one)
//   <jobId>/job.json         one folder per job, exactly as stored on the phone
//   <jobId>/photos/…         the job's photos
//
// Restoring never deletes anything: jobs and templates in the backup are added,
// and where the phone already has the same job/template, whichever copy was
// changed most recently is kept.

const FORMAT = 1;
const META = '_backup';

export type BackupResult = {fileName: string; location: string; jobCount: number; photoCount: number};

export type RestoreResult = {
  added: number;
  updated: number;
  keptPhone: number;
  templatesAdded: number;
  backupDate?: string;
  /** Settings from the backup that this phone doesn't have yet — apply with updateSettings() */
  settingsPatch: Partial<AppSettings>;
};

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function fileName(path: string): string {
  return path.replace(/^file:\/\//, '').split('/').pop() || path;
}

async function rmrf(path: string) {
  if (await RNFS.exists(path)) await RNFS.unlink(path).catch(() => {});
}

async function countPhotos(): Promise<{jobs: number; photos: number}> {
  let jobs = 0;
  let photos = 0;
  for (const item of await RNFS.readDir(SPIKE_DIR)) {
    if (!item.isDirectory() || item.name === META) continue;
    if (!(await RNFS.exists(`${item.path}/job.json`))) continue;
    jobs++;
    const dir = `${item.path}/photos`;
    if (await RNFS.exists(dir)) photos += (await RNFS.readDir(dir)).filter(f => f.isFile()).length;
  }
  return {jobs, photos};
}

// ─── Back up ────────────────────────────────────────────────────────────────

/** Zip every job, photo, saved template and setting into `dir`. Returns the ZIP path. */
export async function writeBackupZip(dir: string) {
  await initStorage();
  const {jobs, photos} = await countPhotos();
  if (jobs === 0) throw new Error('There are no jobs on this phone to back up yet.');

  // Extra files go in a folder next to the job folders so one zip holds everything
  // (the job list ignores folders without a job.json)
  const meta = `${SPIKE_DIR}/${META}`;
  await rmrf(meta);
  await RNFS.mkdir(meta);

  const settings = await loadSettings();
  const createdAt = new Date().toISOString();
  try {
    await RNFS.writeFile(
      `${meta}/manifest.json`,
      JSON.stringify({app: 'SPIKE', format: FORMAT, createdAt, jobCount: jobs, photoCount: photos}),
      'utf8',
    );
    await RNFS.writeFile(`${meta}/templates.json`, JSON.stringify(await loadSavedTemplates()), 'utf8');
    await RNFS.writeFile(`${meta}/settings.json`, JSON.stringify(settings), 'utf8');
    const profilePhoto = settings.profile?.photoPath;
    if (profilePhoto && (await RNFS.exists(profilePhoto))) {
      await RNFS.copyFile(profilePhoto, `${meta}/profile-photo.jpg`);
    }

    if (!(await RNFS.exists(dir))) await RNFS.mkdir(dir);
    const name = `SPIKE_backup_${stamp()}.zip`;
    const path = `${dir}/${name}`;
    await rmrf(path);
    // Photos are already compressed; storing is faster and barely bigger
    await zip(SPIKE_DIR, path, NO_COMPRESSION);
    return {path, fileName: name, jobCount: jobs, photoCount: photos, createdAt};
  } finally {
    await rmrf(meta);
  }
}

// The newest backup is kept here (in the app's cache) so it can be shared
// straight after it's made; it's replaced by the next backup.
const BACKUP_CACHE = `${RNFS.CachesDirectoryPath}/backup`;

/** Back up everything to the phone's Downloads/SPIKE folder */
export async function exportBackup(): Promise<BackupResult & {path: string; createdAt: string}> {
  await rmrf(BACKUP_CACHE);
  const b = await writeBackupZip(BACKUP_CACHE);
  await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
    {name: b.fileName, parentFolder: 'SPIKE', mimeType: 'application/zip'},
    'Download',
    b.path,
  );
  return {...b, location: 'Downloads/SPIKE'};
}

/** Open the share sheet (Drive, email, Nearby Share…) for a backup made by exportBackup */
export async function shareBackup(path: string): Promise<void> {
  await Share.open({
    title: 'Share SPIKE backup',
    subject: `SPIKE backup — ${fileName(path)}`,
    urls: [`file://${path}`],
    type: 'application/zip',
    failOnCancel: false,
  });
}

// ─── Restore ────────────────────────────────────────────────────────────────

/**
 * Let the user choose a backup ZIP (Downloads, Drive, email attachment…) and
 * copy it into the app. Returns its path, or null if they cancelled.
 */
export async function pickBackupFile(): Promise<string | null> {
  try {
    // Some apps label ZIPs differently; the manifest check below catches wrong files
    const [file] = await pick({
      type: [types.zip, 'application/x-zip-compressed', 'application/octet-stream'],
      mode: 'import',
    });
    const [copy] = await keepLocalCopy({
      files: [{uri: file.uri, fileName: file.name ?? 'backup.zip'}],
      destination: 'cachesDirectory',
    });
    if (copy.status !== 'success') throw new Error(copy.copyError || 'Could not read that file.');
    return decodeURIComponent(copy.localUri.replace(/^file:\/\//, ''));
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return null;
    throw e;
  }
}

function newer(a?: string, b?: string): boolean {
  return new Date(a ?? 0).getTime() > new Date(b ?? 0).getTime();
}

/** Point a restored job's photo paths at where the photos now live on this phone */
function relinkPhotos(job: Job): Job {
  const photosDir = `${SPIKE_DIR}/${job.id}/photos`;
  job.structures = job.structures.map((s: Structure) => {
    if (!s.photos) return s;
    return {...s, photos: s.photos.map(p => `${photosDir}/${fileName(p)}`)};
  });
  return job;
}

/** Copy a folder (and everything in it), replacing whatever is at `to` */
async function copyDir(from: string, to: string) {
  await rmrf(to);
  try {
    await RNFS.moveFile(from, to); // same storage — a quick rename
    return;
  } catch {
    // fall back to copying file by file
  }
  await RNFS.mkdir(to);
  for (const item of await RNFS.readDir(from)) {
    if (item.isDirectory()) await copyDir(item.path, `${to}/${item.name}`);
    else await RNFS.copyFile(item.path, `${to}/${item.name}`);
  }
}

/** Restore a backup ZIP (from pickBackupFile) into the app */
export async function restoreBackup(zipPath: string): Promise<RestoreResult> {
  await initStorage();
  const work = `${RNFS.CachesDirectoryPath}/restore_${Date.now()}`;
  try {
    await unzip(zipPath, work);

    const manifestPath = `${work}/${META}/manifest.json`;
    if (!(await RNFS.exists(manifestPath))) {
      throw new Error("That file isn't a SPIKE backup.");
    }
    const manifest = JSON.parse(await RNFS.readFile(manifestPath, 'utf8'));
    if (manifest.app !== 'SPIKE') throw new Error("That file isn't a SPIKE backup.");
    if (manifest.format > FORMAT) {
      throw new Error('This backup was made by a newer version of SPIKE. Update the app, then try again.');
    }

    // Jobs
    const result: RestoreResult = {
      added: 0,
      updated: 0,
      keptPhone: 0,
      templatesAdded: 0,
      backupDate: manifest.createdAt,
      settingsPatch: {},
    };
    for (const item of await RNFS.readDir(work)) {
      if (!item.isDirectory() || item.name === META) continue;
      const jsonPath = `${item.path}/job.json`;
      if (!(await RNFS.exists(jsonPath))) continue;
      const incoming = JSON.parse(await RNFS.readFile(jsonPath, 'utf8')) as Job;
      if (!incoming?.id) continue;

      const existing = await loadJob(incoming.id);
      if (existing && !newer(incoming.updatedAt, existing.updatedAt)) {
        result.keptPhone++; // the phone's copy is the same or newer
        continue;
      }
      await copyDir(item.path, `${SPIKE_DIR}/${incoming.id}`);
      await saveJob(relinkPhotos(incoming));
      if (existing) result.updated++;
      else result.added++;
    }

    // Saved templates: add missing ones, keep the newer copy of the same one
    const tplPath = `${work}/${META}/templates.json`;
    if (await RNFS.exists(tplPath)) {
      const incoming = JSON.parse(await RNFS.readFile(tplPath, 'utf8')) as JobTemplate[];
      const current = await loadSavedTemplates();
      const byId = new Map(current.map(t => [t.id, t]));
      for (const t of Array.isArray(incoming) ? incoming : []) {
        const have = byId.get(t.id);
        if (!have) result.templatesAdded++;
        if (!have || newer(t.updatedAt, have.updatedAt)) byId.set(t.id, t);
      }
      await replaceSavedTemplates([...byId.values()]);
    }

    // Settings: only fill in what this phone doesn't have yet (e.g. after a
    // reinstall) — never overwrite choices already made on this phone
    const setPath = `${work}/${META}/settings.json`;
    if (await RNFS.exists(setPath)) {
      const incoming = JSON.parse(await RNFS.readFile(setPath, 'utf8')) as AppSettings;
      const current = await loadSettings();
      const patch = result.settingsPatch;
      if (!current.networkColors && incoming.networkColors) patch.networkColors = incoming.networkColors;
      if (!current.lastTemplateId && incoming.lastTemplateId) patch.lastTemplateId = incoming.lastTemplateId;
      if (!current.profile?.name && incoming.profile) {
        patch.profile = {...incoming.profile, photoPath: undefined};
        const photo = `${work}/${META}/profile-photo.jpg`;
        if (await RNFS.exists(photo)) {
          const dest = `${RNFS.DocumentDirectoryPath}/profile-photo-${Date.now()}.jpg`;
          await RNFS.copyFile(photo, dest);
          patch.profile.photoPath = dest;
        }
      }
    }

    return result;
  } finally {
    await rmrf(work);
    await rmrf(zipPath);
  }
}
