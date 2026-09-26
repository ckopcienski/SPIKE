import RNFS from 'react-native-fs';
import type {Job} from './storage';
import {
  ALL_STRUCTURE_FIELDS,
  DEFAULT_CONDITIONS,
  DEFAULT_CONSTRUCTION_TYPES,
  StructureFieldId,
  cleanFieldList,
} from '../data/structureFields';
import {
  CoordinateSystem,
  SPIKE_COORDINATE_SYSTEM,
  describeCoordinateSystem,
} from '../data/coordinateSystems';

// ─── Types ──────────────────────────────────────────────────────────────────

/** The pick lists a job uses. Copied from its template when the job is created. */
export interface TemplateLists {
  structureTypes: string[];
  pipeSizes: string[];
  pipeMaterials: string[];
  castingSizesRound: string[];
  castingSizesRectW: string[];
  castingSizesRectL: string[];
  /** Optional structure-detail fields that are on (City, STA/Offset, Sump …) */
  structureFields: StructureFieldId[];
  constructionTypes: string[];
  conditions: string[];
}

export interface JobTemplate extends TemplateLists {
  id: string;
  name: string;
  /** Goes up by 1 each time the template is saved */
  version: number;
  /** Who the template belongs to — only 'device' for now; 'user' / 'company' once accounts exist */
  owner: 'device' | 'user' | 'company';
  /** The built-in S.P.I.K.E template: can't be edited or removed, only duplicated */
  builtIn?: boolean;
  updatedAt: string;
  coordinateSystem: CoordinateSystem;
}

// ─── Built-in S.P.I.K.E template ────────────────────────────────────────────

export const SPIKE_TEMPLATE_ID = 'spike-default';

// Placeholder contents (the app's original lists) — to be finalised
export const SPIKE_TEMPLATE: JobTemplate = {
  id: SPIKE_TEMPLATE_ID,
  name: 'S.P.I.K.E',
  version: 3,
  owner: 'device',
  builtIn: true,
  updatedAt: '2026-09-26T18:00:00.000Z',
  // SMH = sanitary manhole, STMH = storm manhole, CB = catch basin,
  // CI = curb inlet, YD = yard drain (v1 used the full names)
  structureTypes: ['SMH', 'STMH', 'CB', 'CI', 'YD'],
  pipeSizes: ['4"', '6"', '8"', '10"', '12"', '15"', '18"', '21"', '24"', '30"', '36"', '42"', '48"'],
  pipeMaterials: ['PVC', 'RCP', 'VCP', 'DIP', 'HDPE', 'CMP', 'Unknown'],
  castingSizesRound: ['1.5', '2.0', '2.2', '2.5', '3.0'],
  castingSizesRectW: ['2.0', '2.5', '3.0', '3.5', '4.0'],
  castingSizesRectL: ['2.0', '2.5', '3.0', '3.5', '4.0', '5.0'],
  // v3: every optional structure field is on
  structureFields: [...ALL_STRUCTURE_FIELDS],
  constructionTypes: [...DEFAULT_CONSTRUCTION_TYPES],
  conditions: [...DEFAULT_CONDITIONS],
  coordinateSystem: SPIKE_COORDINATE_SYSTEM,
};

/**
 * Fill in lists that older templates/jobs don't have yet. Anything made before
 * the optional structure fields existed gets all of them (like S.P.I.K.E).
 */
export function withListDefaults<T extends Partial<TemplateLists>>(l: T): T & TemplateLists {
  return {
    ...l,
    structureTypes: l.structureTypes ?? [...SPIKE_TEMPLATE.structureTypes],
    pipeSizes: l.pipeSizes ?? [...SPIKE_TEMPLATE.pipeSizes],
    pipeMaterials: l.pipeMaterials ?? [...SPIKE_TEMPLATE.pipeMaterials],
    castingSizesRound: l.castingSizesRound ?? [...SPIKE_TEMPLATE.castingSizesRound],
    castingSizesRectW: l.castingSizesRectW ?? [...SPIKE_TEMPLATE.castingSizesRectW],
    castingSizesRectL: l.castingSizesRectL ?? [...SPIKE_TEMPLATE.castingSizesRectL],
    structureFields: cleanFieldList(l.structureFields),
    constructionTypes: l.constructionTypes ?? [...DEFAULT_CONSTRUCTION_TYPES],
    conditions: l.conditions ?? [...DEFAULT_CONDITIONS],
  };
}

/** e.g. "S.P.I.K.E (OH North, NAD83 / NAVD88)" */
export function templateLabel(t: JobTemplate): string {
  return `${t.name} (${describeCoordinateSystem(t.coordinateSystem)})`;
}

/** e.g. "5 structure types · 13 sizes · 7 materials" */
export function templateSummary(t: TemplateLists): string {
  return `${t.structureTypes.length} structure types · ${t.pipeSizes.length} sizes · ${t.pipeMaterials.length} materials`;
}

// ─── Saved (user) templates ─────────────────────────────────────────────────

const TEMPLATES_PATH = `${RNFS.DocumentDirectoryPath}/spike-templates.json`;

async function loadUserTemplates(): Promise<JobTemplate[]> {
  try {
    if (!(await RNFS.exists(TEMPLATES_PATH))) return [];
    const list = JSON.parse(await RNFS.readFile(TEMPLATES_PATH, 'utf8'));
    return Array.isArray(list) ? list.map(t => withListDefaults(t)) : [];
  } catch {
    return [];
  }
}

/** Saved (non-built-in) templates, for backup */
export const loadSavedTemplates = loadUserTemplates;
/** Replace all saved templates (used by restore) */
export const replaceSavedTemplates = (list: JobTemplate[]) => writeUserTemplates(list);

async function writeUserTemplates(list: JobTemplate[]): Promise<void> {
  await RNFS.writeFile(TEMPLATES_PATH, JSON.stringify(list), 'utf8');
}

/** All templates: S.P.I.K.E first, then saved ones A–Z */
export async function loadTemplates(): Promise<JobTemplate[]> {
  const user = await loadUserTemplates();
  user.sort((a, b) => a.name.localeCompare(b.name));
  return [SPIKE_TEMPLATE, ...user];
}

export async function getTemplate(id: string): Promise<JobTemplate | undefined> {
  if (id === SPIKE_TEMPLATE_ID) return SPIKE_TEMPLATE;
  return (await loadUserTemplates()).find(t => t.id === id);
}

/** Create or update a saved template (the built-in one can't be saved over) */
export async function saveTemplate(t: JobTemplate): Promise<void> {
  if (t.builtIn || t.id === SPIKE_TEMPLATE_ID) return;
  const list = await loadUserTemplates();
  const i = list.findIndex(x => x.id === t.id);
  if (i >= 0) list[i] = t;
  else list.push(t);
  await writeUserTemplates(list);
}

export async function removeTemplate(id: string): Promise<void> {
  if (id === SPIKE_TEMPLATE_ID) return;
  const list = await loadUserTemplates();
  await writeUserTemplates(list.filter(t => t.id !== id));
}

// ─── Jobs ───────────────────────────────────────────────────────────────────

function copyLists(t: TemplateLists): TemplateLists {
  return {
    structureTypes: [...t.structureTypes],
    pipeSizes: [...t.pipeSizes],
    pipeMaterials: [...t.pipeMaterials],
    castingSizesRound: [...t.castingSizesRound],
    castingSizesRectW: [...t.castingSizesRectW],
    castingSizesRectL: [...t.castingSizesRectL],
    structureFields: [...t.structureFields],
    constructionTypes: [...t.constructionTypes],
    conditions: [...t.conditions],
  };
}

/** The fields a new job copies from its template (so later template edits never change it) */
export function jobFieldsFromTemplate(t: JobTemplate) {
  return {
    templateId: t.id,
    templateName: t.name,
    templateVersion: t.version,
    lists: copyLists(t),
    coordinateSystem: {...t.coordinateSystem},
  };
}

/** A job's pick lists (jobs created before templates use the S.P.I.K.E lists) */
export function jobLists(job: Job): TemplateLists {
  return withListDefaults(job.lists ?? SPIKE_TEMPLATE);
}

/** Is this optional structure field on for the job? */
export function jobHasField(job: Job, id: StructureFieldId): boolean {
  return jobLists(job).structureFields.includes(id);
}

/** Combine lists, dropping blanks and duplicates (ignoring upper/lower case), keeping order */
function mergeLists(...lists: (string[] | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const v = (raw ?? '').trim();
      const key = v.toLowerCase();
      if (!v || seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

/**
 * Build a new (unsaved) template from a job: the job's own lists, plus anything
 * added in the field with "+ Custom" or used on its structures, plus its coordinate system.
 */
export function templateFromJob(job: Job): JobTemplate {
  const l = jobLists(job);
  const pipes = job.structures.flatMap(s => s.pipes);
  const round = job.structures.filter(s => s.castingShape === 'round');
  const rect = job.structures.filter(s => s.castingShape === 'rectangular');
  return {
    id: '',
    name: job.name,
    version: 0,
    owner: 'device',
    updatedAt: '',
    structureTypes: mergeLists(l.structureTypes, job.customStructureTypes, job.structures.map(s => s.type)),
    pipeSizes: mergeLists(l.pipeSizes, job.customPipeSizes, pipes.map(p => p.size)),
    pipeMaterials: mergeLists(l.pipeMaterials, job.customPipeMaterials, pipes.map(p => p.material)),
    castingSizesRound: mergeLists(l.castingSizesRound, round.map(s => s.castingWidth)),
    castingSizesRectW: mergeLists(l.castingSizesRectW, rect.map(s => s.castingWidth)),
    castingSizesRectL: mergeLists(l.castingSizesRectL, rect.map(s => s.castingLength)),
    structureFields: [...l.structureFields],
    constructionTypes: mergeLists(
      l.constructionTypes,
      job.customConstructionTypes,
      job.structures.map(s => s.constructionType ?? ''),
    ),
    conditions: mergeLists(l.conditions, job.structures.map(s => s.condition ?? '')),
    coordinateSystem: {...jobCoordinateSystem(job)},
  };
}

/** A job's coordinate system (jobs created before templates use OH North, NAD83 / NAVD88) */
export function jobCoordinateSystem(job: Job): CoordinateSystem {
  return job.coordinateSystem ?? SPIKE_COORDINATE_SYSTEM;
}
