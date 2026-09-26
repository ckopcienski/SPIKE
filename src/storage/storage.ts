import RNFS from 'react-native-fs';
import type {TemplateLists} from './templates';
import type {CoordinateSystem} from '../data/coordinateSystems';
import type {ControlPoint, GpsCalibration} from '../utils/calibration';

const BASE_DIR = RNFS.DocumentDirectoryPath + '/SPIKE';
/** Folder holding every job (one sub-folder per job) — used by backup/restore */
export const SPIKE_DIR = BASE_DIR;

export interface Pipe {
  id: string;
  direction: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  size: string;
  material: string;
  depthBelowRim: number;
}

export interface Structure {
  id: string;
  jobId: string;
  structureId: string;
  /** Structure type name from the job's list (e.g. 'Sanitary manhole') */
  type: string;
  street: string;
  rimElevation: string;
  castingSize?: string; // legacy — not set by the form (uses castingShape/Width/Length)
  /** Worked out from the entries: no length = round (width is the diameter) */
  castingShape: 'round' | 'rectangular';
  /** Diameter for round castings, width for rectangular; '' if not recorded */
  castingWidth: string;
  /** '' for round castings */
  castingLength: string;
  depth: string;
  notes: string;
  latitude: number;
  longitude: number;
  dmsCoordinates: string;
  /** Phone GPS before any calibration shift (latitude/longitude above include the shift) */
  rawLatitude?: number;
  rawLongitude?: number;
  /** Calibration applied when the position was recorded (id + control point name) */
  calibrationId?: string;
  calibrationPoint?: string;
  pipes: Pipe[];

  // ─── Optional details (shown only if the job's template has the field on) ───
  city?: string;
  /** Station, always "NN+NN.NN" (e.g. "12+34.56") */
  station?: string;
  /** Offset in ft, 2 decimals */
  offset?: string;
  offsetSide?: 'LT' | 'RT';
  /** Structure size: length (or diameter when width is blank), width, height — ft */
  sizeLength?: string;
  sizeWidth?: string;
  sizeHeight?: string;
  constructionType?: string;
  condition?: string;
  sump?: boolean;
  /** Sump depth below the lowest invert, ft */
  sumpDepth?: string;
  needsCleaning?: boolean;
  steps?: boolean;
  /** Side of the structure the steps are on (N, NE … NW) */
  stepsDirection?: string;

  /** Absolute paths of this structure's photos, in the order they were taken */
  photos?: string[];
  /** @deprecated single-photo field from older versions — use getStructurePhotos() */
  photoPath?: string;
  createdAt: string;
}

export interface Job {
  id: string;
  name: string;
  jobNumber: string;
  /** @deprecated chosen on older jobs only — the network now comes from the structures (jobNetworkLabel) */
  networkType?: 'Sanitary' | 'Storm' | 'Both';
  crew: string;
  createdAt: string;
  updatedAt: string;
  streets: string[];
  structures: Structure[];
  customStructureTypes?: string[];
  /** Pipe sizes added with "+ Custom" (e.g. '54"', '19" x 30"'), available to every structure in the job */
  customPipeSizes?: string[];
  /** Pipe materials added with "+ Custom" (e.g. 'Brick', 'CIPP'), available to every structure in the job */
  customPipeMaterials?: string[];
  /** Construction types added with "+ Custom" */
  customConstructionTypes?: string[];

  // ─── GPS calibration ───
  /** Known control points for this job (in its coordinate system) */
  controlPoints?: ControlPoint[];
  /** The calibration in use for new structures (none = raw phone GPS) */
  calibration?: GpsCalibration | null;
  /** Every calibration made on this job, newest first */
  calibrationHistory?: GpsCalibration[];

  // ─── Copied from the job's template when the job was created ───
  // (editing or removing the template later never changes an existing job)
  templateId?: string;
  templateName?: string;
  templateVersion?: number;
  /** Pick lists (structure types, pipe sizes, materials, casting sizes) */
  lists?: TemplateLists;
  /** Zone, horizontal & vertical datum and units used for the CSV export */
  coordinateSystem?: CoordinateSystem;
}

// Ensure base directory exists
export async function initStorage(): Promise<void> {
  const exists = await RNFS.exists(BASE_DIR);
  if (!exists) {
    await RNFS.mkdir(BASE_DIR);
  }
}

// Get path for a specific job
function jobPath(jobId: string): string {
  return `${BASE_DIR}/${jobId}`;
}

// Get path for a specific job's data file
function jobFilePath(jobId: string): string {
  return `${jobPath(jobId)}/job.json`;
}

// Save a job to disk
export async function saveJob(job: Job): Promise<void> {
  const dir = jobPath(job.id);
  const exists = await RNFS.exists(dir);
  if (!exists) {
    await RNFS.mkdir(dir);
  }
  await RNFS.writeFile(jobFilePath(job.id), JSON.stringify(job), 'utf8');
}

// Load a single job from disk
export async function loadJob(jobId: string): Promise<Job | null> {
  try {
    const path = jobFilePath(jobId);
    const exists = await RNFS.exists(path);
    if (!exists) return null;
    const content = await RNFS.readFile(path, 'utf8');
    const job = JSON.parse(content) as Job;
    await migrateLegacyPhotos(job);
    return job;
  } catch {
    return null;
  }
}

// Older versions stored one photo per structure in `photoPath`, which pointed
// at a temporary cache file; the permanent copy was saved as
// <job>/<StructureID>/<StructureID>_photo.jpg. Convert those to `photos`.
async function migrateLegacyPhotos(job: Job): Promise<void> {
  for (const s of job.structures) {
    if (s.photos || !s.photoPath) continue;
    const candidates = [
      `${jobPath(job.id)}/${s.structureId}/${s.structureId}_photo.jpg`,
      stripFileScheme(s.photoPath),
    ];
    s.photos = [];
    for (const c of candidates) {
      if (await RNFS.exists(c)) {
        s.photos = [c];
        break;
      }
    }
    delete s.photoPath;
  }
}

// Load all jobs from disk
export async function loadAllJobs(): Promise<Job[]> {
  try {
    await initStorage();
    const items = await RNFS.readDir(BASE_DIR);
    const jobs: Job[] = [];
    for (const item of items) {
      if (item.isDirectory()) {
        const job = await loadJob(item.name);
        if (job) jobs.push(job);
      }
    }
    return jobs.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  } catch {
    return [];
  }
}

// Delete a job from disk
export async function deleteJob(jobId: string): Promise<void> {
  const dir = jobPath(jobId);
  const exists = await RNFS.exists(dir);
  if (exists) {
    await RNFS.unlink(dir);
  }
}

// ─── Photos ────────────────────────────────────────────────────────────────
// Photos live in <job>/photos/ and are named after the structure:
// MH-12_1.jpg, MH-12_2.jpg, … Numbers are never reused, so deleting
// MH-12_2.jpg and taking another photo gives MH-12_3.jpg.

function photosDir(jobId: string): string {
  return `${jobPath(jobId)}/photos`;
}

function stripFileScheme(path: string): string {
  return path.replace(/^file:\/\//, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Make a structure ID safe to use in a file name ("MH 12/A" → "MH-12-A")
export function photoFileBase(structureName: string): string {
  return structureName.trim().replace(/[\\/:*?"<>|\s]+/g, '-') || 'structure';
}

// All photos for a structure (handles data saved by older versions)
export function getStructurePhotos(s: Structure): string[] {
  if (s.photos) return s.photos;
  return s.photoPath ? [s.photoPath] : [];
}

// URI usable in <Image source={{uri}} />
export function photoUri(path: string): string {
  return path.startsWith('file://') || path.startsWith('content://')
    ? path
    : `file://${path}`;
}

// Just the file name, e.g. "MH-12_3.jpg"
export function photoFileName(path: string): string {
  return path.split('/').pop() || path;
}

// Full path the next photo for this structure will be saved to
export async function nextPhotoPath(
  jobId: string,
  structureName: string,
): Promise<string> {
  const dir = photosDir(jobId);
  if (!(await RNFS.exists(dir))) {
    await RNFS.mkdir(dir);
  }
  const base = photoFileBase(structureName);
  const pattern = new RegExp(`^${escapeRegex(base)}_(\\d+)\\.jpg$`, 'i');
  let max = 0;
  for (const item of await RNFS.readDir(dir)) {
    const m = item.name.match(pattern);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${dir}/${base}_${max + 1}.jpg`;
}

// Copy a captured photo into the job's photos folder; returns the saved path
export async function savePhoto(
  jobId: string,
  structureName: string,
  sourcePath: string,
): Promise<string> {
  const destPath = await nextPhotoPath(jobId, structureName);
  await RNFS.copyFile(stripFileScheme(sourcePath), destPath);
  return destPath;
}

// Delete photo files from disk (missing files are ignored)
export async function deletePhotoFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    try {
      const path = stripFileScheme(p);
      if (await RNFS.exists(path)) await RNFS.unlink(path);
    } catch {
      // ignore — a leftover file is harmless
    }
  }
}

// When a structure's ID changes, rename its photos to match.
// Returns the new list of paths (photos whose files are missing are dropped).
export async function renameStructurePhotos(
  jobId: string,
  paths: string[],
  newStructureName: string,
): Promise<string[]> {
  const renamed: string[] = [];
  for (const p of paths) {
    const src = stripFileScheme(p);
    if (!(await RNFS.exists(src))) continue;
    try {
      const dest = await nextPhotoPath(jobId, newStructureName);
      await RNFS.moveFile(src, dest);
      renamed.push(dest);
    } catch {
      renamed.push(src); // couldn't rename — keep the photo under its old name
    }
  }
  return renamed;
}

// Generate a unique ID
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}