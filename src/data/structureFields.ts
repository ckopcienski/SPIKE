// Optional structure-detail fields (from the paper Utility Structure Data Sheet).
// A template switches each one on or off; a job copies that list, and a field
// shows on the New/Edit Structure screen, the PDF and the CSV only when it's on.

export type StructureFieldId =
  | 'city'
  | 'staOffset'
  | 'structureSize'
  | 'constructionType'
  | 'condition'
  | 'sump'
  | 'needsCleaning'
  | 'steps';

export const STRUCTURE_FIELDS: {id: StructureFieldId; label: string; hint: string}[] = [
  {id: 'city', label: 'City', hint: 'Text box'},
  {id: 'staOffset', label: 'STA / Offset', hint: 'Station (12+34.56) and offset LT / RT'},
  {id: 'structureSize', label: 'Structure size', hint: 'L × W × H, or DIA × H'},
  {id: 'constructionType', label: 'Construction type', hint: 'Pick list below'},
  {id: 'condition', label: 'Condition', hint: 'Pick list below'},
  {id: 'sump', label: 'Sump', hint: 'Yes / No + depth below lowest invert'},
  {id: 'needsCleaning', label: 'Needs cleaning', hint: 'Yes / No'},
  {id: 'steps', label: 'Steps', hint: 'Yes / No + which side'},
];

export const ALL_STRUCTURE_FIELDS: StructureFieldId[] = STRUCTURE_FIELDS.map(f => f.id);

export const DEFAULT_CONSTRUCTION_TYPES = ['Precast', 'Block', 'Brick', 'Poured'];
export const DEFAULT_CONDITIONS = ['New', 'Good', 'Fair', 'Poor'];

/** Only the known field ids, in the standard order */
export function cleanFieldList(list: string[] | undefined): StructureFieldId[] {
  if (!Array.isArray(list)) return [...ALL_STRUCTURE_FIELDS];
  return ALL_STRUCTURE_FIELDS.filter(id => list.includes(id));
}

// ─── Station / offset ───────────────────────────────────────────────────────

/**
 * Normalise a station to "NN+NN.NN".
 * "12+00" → "12+00.00", "12+34.5" → "12+34.50", "1234.56" → "12+34.56", "0+50" → "0+50.00".
 * Returns null if it can't be read as a station. Blank → ''.
 */
export function formatStation(input: string): string | null {
  const t = (input ?? '').trim().replace(/\s+/g, '');
  if (!t) return '';
  let feet: number;
  const plus = t.match(/^(-?)(\d+)\+(\d+(?:\.\d*)?)$/);
  if (plus) {
    const hundreds = parseInt(plus[2], 10);
    const rest = parseFloat(plus[3]);
    if (!isFinite(rest) || rest >= 100) return null; // "12+150" isn't a valid station
    feet = hundreds * 100 + rest;
    if (plus[1]) feet = -feet;
  } else if (/^-?\d+(\.\d*)?$/.test(t)) {
    feet = parseFloat(t);
  } else {
    return null;
  }
  const neg = feet < 0;
  const cents = Math.round(Math.abs(feet) * 100); // to 0.01 ft
  const hundreds = Math.floor(cents / 10000);
  const rest = (cents % 10000) / 100;
  const restStr = rest.toFixed(2).padStart(5, '0'); // "04.50"
  return `${neg ? '-' : ''}${hundreds}+${restStr}`;
}

/** Station in feet (for sorting/CSV); null if blank or unreadable */
export function stationFeet(sta: string | undefined): number | null {
  const f = formatStation(sta ?? '');
  if (!f) return null;
  const m = f.match(/^(-?)(\d+)\+(\d+\.\d+)$/)!;
  const v = parseInt(m[2], 10) * 100 + parseFloat(m[3]);
  return m[1] ? -v : v;
}

/** Offset to 2 decimals, e.g. "12.5" → "12.50"; '' if blank; null if not a number */
export function formatOffset(input: string): string | null {
  const t = (input ?? '').trim();
  if (!t) return '';
  if (!/^\d+(\.\d*)?$/.test(t)) return null;
  return parseFloat(t).toFixed(2);
}

// ─── Display (PDF / CSV) ────────────────────────────────────────────────────

type Details = {
  city?: string;
  station?: string;
  offset?: string;
  offsetSide?: 'LT' | 'RT';
  sizeLength?: string;
  sizeWidth?: string;
  sizeHeight?: string;
  constructionType?: string;
  condition?: string;
  sump?: boolean;
  sumpDepth?: string;
  needsCleaning?: boolean;
  steps?: boolean;
  stepsDirection?: string;
};

const ft = (v?: string) => (v?.trim() ? `${v.trim()}'` : '');
const yesNo = (v?: boolean) => (v === true ? 'Yes' : v === false ? 'No' : '');

export function offsetText(s: Details): string {
  if (!s.offset?.trim()) return '';
  return `${s.offset.trim()}${s.offsetSide ? ` ${s.offsetSide}` : ''}`;
}

/** "4.0' × 5.0' × 8.0' H" or "DIA 4.0' × 8.0' H" ('' if nothing entered) */
export function structureSizeText(s: Details): string {
  const l = s.sizeLength?.trim();
  const w = s.sizeWidth?.trim();
  const h = s.sizeHeight?.trim();
  if (!l && !w && !h) return '';
  const plan = w ? `${ft(l) || '—'} × ${ft(w)}` : l ? `DIA ${ft(l)}` : '';
  return [plan, h ? `${ft(h)} H` : ''].filter(Boolean).join(' × ');
}

export function sumpText(s: Details): string {
  if (s.sump !== true) return yesNo(s.sump);
  return s.sumpDepth?.trim() ? `Yes, ${ft(s.sumpDepth)} below inv.` : 'Yes';
}

export function stepsText(s: Details): string {
  if (s.steps !== true) return yesNo(s.steps);
  return s.stepsDirection ? `Yes, ${s.stepsDirection} side` : 'Yes';
}

/** CSV columns for the fields that are on (header + value getter) */
export function fieldColumns(
  fields: StructureFieldId[],
): {header: string; value: (s: Details) => string}[] {
  const cols: {header: string; value: (s: Details) => string}[] = [];
  for (const id of fields) {
    switch (id) {
      case 'city':
        cols.push({header: 'City', value: s => s.city ?? ''});
        break;
      case 'staOffset':
        cols.push({header: 'Station', value: s => s.station ?? ''});
        cols.push({header: 'Offset (ft)', value: s => s.offset ?? ''});
        cols.push({header: 'Offset Side', value: s => (s.offset ? s.offsetSide ?? '' : '')});
        break;
      case 'structureSize':
        cols.push({header: 'Structure Length/DIA (ft)', value: s => s.sizeLength ?? ''});
        cols.push({header: 'Structure Width (ft)', value: s => s.sizeWidth ?? ''});
        cols.push({header: 'Structure Height (ft)', value: s => s.sizeHeight ?? ''});
        break;
      case 'constructionType':
        cols.push({header: 'Construction Type', value: s => s.constructionType ?? ''});
        break;
      case 'condition':
        cols.push({header: 'Condition', value: s => s.condition ?? ''});
        break;
      case 'sump':
        cols.push({header: 'Sump', value: s => yesNo(s.sump)});
        cols.push({header: 'Sump Depth Below Invert (ft)', value: s => (s.sump ? s.sumpDepth ?? '' : '')});
        break;
      case 'needsCleaning':
        cols.push({header: 'Needs Cleaning', value: s => yesNo(s.needsCleaning)});
        break;
      case 'steps':
        cols.push({header: 'Steps', value: s => yesNo(s.steps)});
        cols.push({header: 'Steps Side', value: s => (s.steps ? s.stepsDirection ?? '' : '')});
        break;
    }
  }
  return cols;
}
