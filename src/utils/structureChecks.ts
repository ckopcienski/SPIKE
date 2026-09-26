// Quick sanity checks run when a structure is saved with the header "Save"
// button, to catch typos while the crew is still standing at the structure.
// They only warn — the user can always "Save anyway".

import type {Pipe} from '../storage/storage';
import {formatStation, formatOffset} from '../data/structureFields';

export type StructureCheckInput = {
  /** Internal id of this structure ('' if not saved yet) */
  recordId: string;
  structureId: string;
  rimElevation: string;
  depth: string;
  pipes: Pipe[];
  /** Other structures already in the job */
  others: {id: string; structureId: string}[];
  castingWidth?: string;
  castingLength?: string;
  /** Only checked when the field is on for the job */
  station?: string;
  offset?: string;
  sizeLength?: string;
  sizeWidth?: string;
  sizeHeight?: string;
  sumpDepth?: string;
};

const isNum = (v: string) => /^-?\d+(\.\d+)?$|^-?\.\d+$/.test(v.trim());

/** Returns a list of plain-language warnings (empty = all good) */
export function checkStructure(s: StructureCheckInput): string[] {
  const w: string[] = [];

  // Duplicate Structure ID in the same job
  const id = s.structureId.trim().toLowerCase();
  if (id && s.others.some(o => o.id !== s.recordId && o.structureId.trim().toLowerCase() === id)) {
    w.push(`Structure ID ${s.structureId.trim()} is already used by another structure in this job.`);
  }

  // Numbers that don't read as numbers
  const numeric: [string, string | undefined][] = [
    ['Rim elevation', s.rimElevation],
    ['Structure depth', s.depth],
    ['Casting diameter/width', s.castingWidth],
    ['Casting length', s.castingLength],
    ['Structure length/DIA', s.sizeLength],
    ['Structure width', s.sizeWidth],
    ['Structure height', s.sizeHeight],
    ['Sump depth', s.sumpDepth],
  ];
  for (const [label, v] of numeric) {
    if (v && v.trim() && !isNum(v)) w.push(`${label} "${v.trim()}" isn't a number.`);
  }
  if (s.station && formatStation(s.station) === null) {
    w.push(`Station "${s.station.trim()}" can't be read — use 12+34.56 or 1234.56.`);
  }
  if (s.offset && formatOffset(s.offset) === null) {
    w.push(`Offset "${s.offset.trim()}" isn't a number of feet.`);
  }

  // Structure depth should be a positive distance
  const depth = isNum(s.depth || '') ? parseFloat(s.depth) : null;
  if (depth !== null && depth < 0) {
    w.push(`Structure depth is negative (${depth}). It's a distance down from the rim — enter it as a positive number.`);
  }
  const structDepth = depth === null ? null : Math.abs(depth);

  // Pipes
  s.pipes.forEach((p, i) => {
    const n = `Pipe ${i + 1}`;
    const d = Number(p.depthBelowRim);
    if (!d) {
      w.push(`${n} has no depth.`);
      return;
    }
    if (d > 0) {
      w.push(`${n} depth is positive (${d.toFixed(2)}). Pipe depths are entered as negative (e.g. -${d.toFixed(2)}).`);
    }
    const deeper = structDepth !== null && structDepth > 0 && Math.abs(d) > structDepth + 0.05;
    if (deeper) {
      w.push(
        `${n} is deeper (${Math.abs(d).toFixed(2)}') than the structure (${structDepth!.toFixed(2)}').`,
      );
    } else if (Math.abs(d) > 50) {
      w.push(`${n} depth ${Math.abs(d).toFixed(2)}' looks too deep — check for a typo.`);
    }
  });

  if (structDepth !== null && structDepth > 50) {
    w.push(`Structure depth ${structDepth.toFixed(2)}' looks too deep — check for a typo.`);
  }

  return w;
}
