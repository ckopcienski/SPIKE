// Which network (sanitary / storm) a structure type belongs to.
// Recognises the S.P.I.K.E abbreviations (SMH, STMH, CB, CI, YD) and the
// full names used by older jobs ("Sanitary manhole", "Catch basin", …).

export type Network = 'sanitary' | 'storm' | 'other';

const SANITARY_CODES = new Set(['SMH', 'SAN', 'SSMH']);
const STORM_CODES = new Set(['STMH', 'STM', 'CB', 'CI', 'YD', 'INL', 'HW', 'ES']);

export function networkOfType(type: string): Network {
  const code = (type ?? '').trim().toUpperCase();
  if (SANITARY_CODES.has(code)) return 'sanitary';
  if (STORM_CODES.has(code)) return 'storm';
  const t = code.toLowerCase();
  if (t.includes('sanitary') || t.includes('sewer')) return 'sanitary';
  if (
    t.includes('storm') ||
    t.includes('catch') ||
    t.includes('inlet') ||
    t.includes('yard drain')
  ) {
    return 'storm';
  }
  return 'other';
}

/** 'Sanitary' / 'Storm' for a structure type, or '' if it's neither */
export function networkLabelOfType(type: string): '' | 'Sanitary' | 'Storm' {
  const net = networkOfType(type);
  return net === 'sanitary' ? 'Sanitary' : net === 'storm' ? 'Storm' : '';
}

/**
 * A job's network, worked out from the structures recorded in it:
 * 'Sanitary', 'Storm', 'Both', or '' (nothing recorded yet).
 * Older jobs chose a network type when created — used until structures exist.
 */
export function jobNetworkLabel(job: {
  networkType?: string;
  structures: {type: string}[];
}): '' | 'Sanitary' | 'Storm' | 'Both' {
  const nets = new Set(job.structures.map(s => networkOfType(s.type)));
  const san = nets.has('sanitary');
  const storm = nets.has('storm');
  if (san && storm) return 'Both';
  if (san) return 'Sanitary';
  if (storm) return 'Storm';
  if (job.structures.length === 0 && job.networkType) {
    return job.networkType as 'Sanitary' | 'Storm' | 'Both';
  }
  return '';
}

/** Old full type names → the S.P.I.K.E abbreviations */
const TYPE_CODES: Record<string, string> = {
  'sanitary manhole': 'SMH',
  'storm manhole': 'STMH',
  'catch basin': 'CB',
  catchbasin: 'CB',
  inlet: 'CI',
  'curb inlet': 'CI',
  'yard drain': 'YD',
};

/** Short code for a structure type (SMH, STMH, CB, CI, YD); other types unchanged */
export function typeCode(type: string): string {
  const t = (type ?? '').trim();
  return TYPE_CODES[t.toLowerCase()] ?? t;
}
