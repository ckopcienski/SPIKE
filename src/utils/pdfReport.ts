import {PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, RGB} from 'pdf-lib';
import type {Job, Structure, Pipe} from '../storage/storage';
import type {UserProfile} from '../storage/settings';
import {
  CoordinateSystem,
  describeCoordinateSystem,
  findZone,
  HORIZONTAL_DATUMS,
  VERTICAL_DATUMS,
  UNIT_OPTIONS,
} from '../data/coordinateSystems';
import {projectPoint, coordinateHeaders} from './projection';
import {networkOfType, jobNetworkLabel, typeCode} from './structureTypes';
import {resolveNetworkColors, NetworkColors} from '../data/networkColors';
import {
  StructureFieldId,
  offsetText,
  structureSizeText,
  sumpText,
  stepsText,
} from '../data/structureFields';
import {jobLists} from '../storage/templates';

// ─── Page setup (US Letter landscape, points) ───────────────────────────────
const PAGE_W = 792;
const PAGE_H = 612;
const M = 30; // margin
const CONTENT_W = PAGE_W - 2 * M;
const FOOTER_H = 24;

const SLATE = rgb(77 / 255, 77 / 255, 97 / 255);
const SLATE_LIGHT = rgb(236 / 255, 236 / 255, 241 / 255);
const TEXT = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.5);
const LINE = rgb(0.82, 0.82, 0.86);
const WHITE = rgb(1, 1, 1);

function hexRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Network colours for the report being built (set from the user's choice in buildReportPdf) */
let NETWORK: Record<'sanitary' | 'storm' | 'other', RGB> = networkRgb();

function networkRgb(saved?: Partial<NetworkColors>): Record<'sanitary' | 'storm' | 'other', RGB> {
  const n = resolveNetworkColors(saved);
  return {sanitary: hexRgb(n.sanitary.pdf), storm: hexRgb(n.storm.pdf), other: hexRgb(n.other.pdf)};
}

const networkOf = networkOfType;

const DIR_ANGLE: Record<string, number> = {N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315};

// ─── Small helpers ──────────────────────────────────────────────────────────

function num(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isFinite(n) ? n : null;
}

function ft(n: number | null, decimals = 2): string {
  return n === null ? '—' : `${n.toFixed(decimals)}'`;
}

/** Pipe depth below rim as a positive number, or null if not recorded */
function pipeDepth(p: Pipe): number | null {
  const d = num(p.depthBelowRim);
  return d === null || d === 0 ? null : Math.abs(d);
}

/** Invert elevation = rim − depth (null if either is missing) */
function invertOf(s: Structure, p: Pipe): number | null {
  const rim = num(s.rimElevation);
  const d = pipeDepth(p);
  return rim === null || d === null ? null : rim - d;
}

function formatDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'});
}

// ─── Text drawing ───────────────────────────────────────────────────────────

class Fonts {
  constructor(public regular: PDFFont, public bold: PDFFont) {}
  private ok = new Map<string, boolean>();

  /** Replace characters the standard PDF fonts can't draw (e.g. emoji) */
  safe(text: string): string {
    let out = '';
    for (const ch of String(text ?? '')) {
      let good = this.ok.get(ch);
      if (good === undefined) {
        try {
          this.regular.widthOfTextAtSize(ch, 10);
          good = true;
        } catch {
          good = false;
        }
        this.ok.set(ch, good);
      }
      out += good ? ch : ch === '−' ? '-' : ''; // drop characters the font can't draw (e.g. emoji)
    }
    return out.replace(/[\r\n\t]+/g, ' ');
  }
}

function drawText(
  page: PDFPage,
  f: Fonts,
  text: string,
  x: number,
  y: number,
  opts: {size?: number; bold?: boolean; color?: RGB; maxWidth?: number; align?: 'left' | 'right' | 'center'} = {},
) {
  const font = opts.bold ? f.bold : f.regular;
  const size = opts.size ?? 9;
  let t = f.safe(text);
  if (opts.maxWidth) t = fit(font, t, size, opts.maxWidth);
  const w = font.widthOfTextAtSize(t, size);
  const dx = opts.align === 'right' ? -w : opts.align === 'center' ? -w / 2 : 0;
  page.drawText(t, {x: x + dx, y, size, font, color: opts.color ?? TEXT});
}

/** Shorten text with an ellipsis so it fits a width */
function fit(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/** Split text into lines that fit a width */
function wrap(font: PDFFont, text: string, size: number, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
    else {
      if (line) lines.push(line);
      line = w;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = fit(font, lines[maxLines - 1] + ' …', size, maxWidth);
  }
  return lines;
}

// ─── Report ─────────────────────────────────────────────────────────────────

export type ReportOptions = {
  /** Storm / sanitary colours chosen in Settings (defaults: blue / green) */
  networkColors?: Partial<NetworkColors>;
  coordinateSystem: CoordinateSystem;
  profile?: UserProfile;
  generatedAt?: Date;
};

const CARDS_PER_PAGE = 3;
const CARD_GAP = 14;
const CARD_W = (CONTENT_W - CARD_GAP * (CARDS_PER_PAGE - 1)) / CARDS_PER_PAGE;
const BAND_H = 46; // slate title band on data-sheet pages

/** Build the job's PDF report (landscape; overview page + 3 structure sheets per page). Returns base64. */
export async function buildReportPdf(job: Job, opts: ReportOptions): Promise<string> {
  NETWORK = networkRgb(opts.networkColors);
  const doc = await PDFDocument.create();
  doc.setTitle(`${job.name} — Structure Report`);
  doc.setCreator('S.P.I.K.E');
  doc.setProducer('S.P.I.K.E');
  const f = new Fonts(
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
  );
  const cs = opts.coordinateSystem;
  const generated = opts.generatedAt ?? new Date();
  const [northHeader, eastHeader] = coordinateHeaders(cs);
  const structures = [...job.structures];

  // ════ Overview page ════
  let page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({x: 0, y: PAGE_H - 64, width: PAGE_W, height: 64, color: SLATE});
  drawText(page, f, 'S.P.I.K.E', M, PAGE_H - 34, {size: 22, bold: true, color: WHITE});
  drawText(page, f, 'Structure Report', M, PAGE_H - 51, {size: 11, color: WHITE});
  drawText(page, f, `Generated ${formatDate(generated)}`, PAGE_W - M, PAGE_H - 34, {
    size: 9,
    color: WHITE,
    align: 'right',
  });
  let y = PAGE_H - 90;

  // Job details (left) and totals (right)
  drawText(page, f, job.name, M, y, {size: 16, bold: true, maxWidth: CONTENT_W * 0.6});
  y -= 20;
  const zone = findZone(cs.zoneId);
  const hDatum = HORIZONTAL_DATUMS.find(d => d.id === cs.horizontalDatum);
  const vDatum = VERTICAL_DATUMS.find(d => d.id === cs.verticalDatum);
  const unit = UNIT_OPTIONS.find(u => u.id === cs.units);
  const details: [string, string][] = [
    ['Job number', job.jobNumber || '—'],
    ['Network', ({Both: 'Sanitary & Storm', '': '—'} as Record<string, string>)[jobNetworkLabel(job)] ?? jobNetworkLabel(job)],
    ['Crew', job.crew || '—'],
    ['Template', job.templateName || 'S.P.I.K.E'],
    ['Coordinate system', zone?.label ?? cs.zoneId],
    ['Datums', `${hDatum?.label ?? cs.horizontalDatum}  /  ${vDatum?.short ?? cs.verticalDatum}`],
    ['Units', `${unit?.label ?? cs.units} (elevations & depths in feet)`],
  ];
  const pr = opts.profile;
  if (pr && (pr.name || pr.firm)) {
    const who = [pr.name, pr.title].filter(Boolean).join(', ');
    const firm = [pr.firm, pr.license ? `License ${pr.license}` : ''].filter(Boolean).join(' · ');
    details.push(['Prepared by', [who, firm].filter(Boolean).join(' — ')]);
  }
  const detailsTop = y;
  for (const [label, value] of details) {
    drawText(page, f, label, M, y, {size: 9, color: MUTED});
    drawText(page, f, value, M + 110, y, {size: 9, maxWidth: CONTENT_W * 0.6 - 110});
    y -= 13;
  }

  const pipeCount = structures.reduce((a, s) => a + s.pipes.length, 0);
  const photoCount = structures.reduce((a, s) => a + photoNames(s).length, 0);
  const totals: [string, number][] = [
    ['Structures', structures.length],
    ['Pipes', pipeCount],
    ['Photos', photoCount],
  ];
  const tW = 92;
  totals.forEach(([label, value], i) => {
    const x = PAGE_W - M - (3 - i) * tW - (2 - i) * 8;
    page.drawRectangle({x, y: detailsTop - 40, width: tW, height: 46, color: SLATE_LIGHT});
    drawText(page, f, String(value), x + tW / 2, detailsTop - 16, {size: 18, bold: true, color: SLATE, align: 'center'});
    drawText(page, f, label, x + tW / 2, detailsTop - 32, {size: 8, color: MUTED, align: 'center'});
  });

  // Structure index
  y -= 12;
  const cols = [
    {h: 'Structure', w: 80},
    {h: 'Type', w: 118},
    {h: 'Street', w: 128},
    {h: 'Rim elev.', w: 62, right: true},
    {h: 'Depth', w: 52, right: true},
    {h: 'Pipes', w: 40, right: true},
    {h: 'Photos', w: 44, right: true},
    {h: northHeader, w: 104, right: true},
    {h: eastHeader, w: 104, right: true},
  ];
  const indexHeader = () => {
    page.drawRectangle({x: M, y: y - 4, width: CONTENT_W, height: 16, color: SLATE});
    let x = M + 4;
    for (const c of cols) {
      drawText(page, f, c.h, c.right ? x + c.w - 8 : x, y + 1, {
        size: 7.5,
        bold: true,
        color: WHITE,
        align: c.right ? 'right' : 'left',
        maxWidth: c.w - 6,
      });
      x += c.w;
    }
    y -= 16;
  };
  drawText(page, f, 'STRUCTURES', M, y, {size: 9, bold: true, color: MUTED});
  y -= 16;
  indexHeader();
  structures.forEach((s, i) => {
    if (y - 14 < M + FOOTER_H) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
      indexHeader();
    }
    if (i % 2 === 1) page.drawRectangle({x: M, y: y - 4, width: CONTENT_W, height: 14, color: rgb(0.97, 0.97, 0.98)});
    const {northing, easting} = projectPoint(s.latitude, s.longitude, cs);
    const rim = num(s.rimElevation);
    const depth = num(s.depth);
    const cells = [
      s.structureId,
      typeCode(s.type),
      s.street || '—',
      rim === null ? '—' : rim.toFixed(2),
      depth === null ? '—' : Math.abs(depth).toFixed(2),
      String(s.pipes.length),
      String(photoNames(s).length),
      northing || '—',
      easting || '—',
    ];
    let x = M + 4;
    cells.forEach((cell, ci) => {
      const c = cols[ci];
      drawText(page, f, cell, c.right ? x + c.w - 8 : x, y, {
        size: 8,
        bold: ci === 0,
        align: c.right ? 'right' : 'left',
        maxWidth: c.w - 6,
      });
      x += c.w;
    });
    y -= 14;
  });
  if (structures.length === 0) {
    drawText(page, f, 'No structures recorded yet.', M + 4, y, {size: 9, color: MUTED});
  }

  // ════ Structure data sheets — 3 per landscape page ════
  for (let i = 0; i < structures.length; i += CARDS_PER_PAGE) {
    const pg = doc.addPage([PAGE_W, PAGE_H]);
    pg.drawRectangle({x: 0, y: PAGE_H - BAND_H, width: PAGE_W, height: BAND_H, color: SLATE});
    drawText(pg, f, 'S.P.I.K.E', M, PAGE_H - 22, {size: 15, bold: true, color: WHITE});
    drawText(pg, f, 'Utility Structure Data Sheets', M, PAGE_H - 36, {size: 9, color: WHITE});
    const right = [
      `PROJECT  ${job.name}${job.jobNumber ? `  (#${job.jobNumber})` : ''}`,
      `CREW  ${job.crew || '—'}`,
    ];
    drawText(pg, f, right[0], PAGE_W - M, PAGE_H - 22, {size: 9, bold: true, color: WHITE, align: 'right', maxWidth: 420});
    drawText(pg, f, right[1], PAGE_W - M, PAGE_H - 36, {size: 9, color: WHITE, align: 'right', maxWidth: 420});

    const fields = jobLists(job).structureFields;
    const cardTop = PAGE_H - BAND_H - 12;
    const cardBottom = M + FOOTER_H - 4;
    structures.slice(i, i + CARDS_PER_PAGE).forEach((s, k) => {
      const x = M + k * (CARD_W + CARD_GAP);
      drawDataSheet(pg, f, s, x, cardBottom, CARD_W, cardTop - cardBottom, cs, fields);
    });
  }

  // ── Footers with page numbers ──
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawLine({start: {x: M, y: M + 10}, end: {x: PAGE_W - M, y: M + 10}, thickness: 0.5, color: LINE});
    drawText(
      pg,
      f,
      `S.P.I.K.E · ${job.name}${job.jobNumber ? ` (#${job.jobNumber})` : ''} · ${describeCoordinateSystem(cs)} · Generated ${formatDate(generated)}`,
      M,
      M,
      {size: 7.5, color: MUTED, maxWidth: CONTENT_W - 70},
    );
    drawText(pg, f, `Page ${i + 1} of ${pages.length}`, PAGE_W - M, M, {size: 7.5, color: MUTED, align: 'right'});
  });

  return doc.saveAsBase64();
}

/** File names of a structure's photos (e.g. MH-12_1.jpg) */
function photoNames(s: Structure): string[] {
  const list = s.photos ?? (s.photoPath ? [s.photoPath] : []);
  return list.map(p => p.split('/').pop() || p);
}

// ─── One structure data sheet (card) ────────────────────────────────────────

/** Label in small caps with the value on an underline, like a field form */
function field(
  page: PDFPage,
  f: Fonts,
  label: string,
  value: string,
  x: number,
  y: number,
  w: number,
  opts: {bold?: boolean} = {},
) {
  drawText(page, f, label, x, y, {size: 6.5, bold: true, color: MUTED});
  const lw = f.bold.widthOfTextAtSize(f.safe(label), 6.5) + 5;
  page.drawLine({start: {x: x + lw, y: y - 2.5}, end: {x: x + w, y: y - 2.5}, thickness: 0.5, color: LINE});
  drawText(page, f, value, x + lw + 2, y, {size: 8.5, bold: opts.bold, maxWidth: w - lw - 4});
}

function checkbox(page: PDFPage, f: Fonts, label: string, checked: boolean, x: number, y: number): number {
  page.drawRectangle({x, y: y - 1.5, width: 8, height: 8, borderColor: MUTED, borderWidth: 0.75, color: WHITE});
  if (checked) {
    // tick mark
    page.drawLine({start: {x: x + 1.6, y: y + 2.6}, end: {x: x + 3.5, y: y + 0.4}, thickness: 1.4, color: SLATE});
    page.drawLine({start: {x: x + 3.5, y: y + 0.4}, end: {x: x + 7, y: y + 5.6}, thickness: 1.4, color: SLATE});
  }
  drawText(page, f, label, x + 11, y, {size: 7, bold: checked, color: checked ? TEXT : MUTED});
  return x + 11 + f.regular.widthOfTextAtSize(label, 7) + 10;
}

function drawDataSheet(
  page: PDFPage,
  f: Fonts,
  s: Structure,
  x: number,
  bottom: number,
  w: number,
  h: number,
  cs: CoordinateSystem,
  fields: StructureFieldId[],
) {
  const has = (id: StructureFieldId) => fields.includes(id);
  const net = networkOf(s.type);
  const netColor = NETWORK[net];
  const top = bottom + h;
  const pad = 8;
  const ix = x + pad;
  const iw = w - 2 * pad;

  page.drawRectangle({x, y: bottom, width: w, height: h, borderColor: LINE, borderWidth: 0.75});

  // Title strip
  page.drawRectangle({x, y: top - 22, width: w, height: 22, color: SLATE_LIGHT});
  page.drawRectangle({x, y: top - 22, width: 4, height: 22, color: netColor});
  drawText(page, f, s.structureId, ix + 2, top - 15, {size: 11, bold: true, maxWidth: iw * 0.45});
  // Network (top right), in the network's colour
  const netName = net === 'storm' ? 'STORM' : net === 'sanitary' ? 'SANITARY' : 'UNKNOWN';
  drawText(page, f, netName, x + w - pad, top - 15, {size: 9, bold: true, color: net === 'other' ? MUTED : netColor, align: 'right', maxWidth: iw * 0.5});

  let y = top - 36;
  const photos = photoNames(s);
  const pics =
    photos.length === 0 ? '—' : photos.length === 1 ? photos[0] : `${photos.length}: ${photos.map(n => n.replace(/\.jpg$/i, '')).join(', ')}`;
  field(page, f, 'POINT NO.', s.structureId, ix, y, iw * 0.42, {bold: true});
  field(page, f, 'PIC.#', pics, ix + iw * 0.46, y, iw * 0.54);
  y -= 15;
  if (has('city')) {
    field(page, f, 'STREET NAME', s.street || '—', ix, y, iw * 0.56);
    field(page, f, 'CITY', s.city || '—', ix + iw * 0.6, y, iw * 0.4);
  } else {
    field(page, f, 'STREET NAME', s.street || '—', ix, y, iw);
  }
  y -= 15;
  field(page, f, 'STRUCTURE TYPE', typeCode(s.type) || '—', ix, y, iw, {bold: true});
  if (has('staOffset')) {
    y -= 15;
    field(page, f, 'STA', s.station || '—', ix, y, iw * 0.5, {bold: true});
    field(page, f, 'OFFSET', offsetText(s) || '—', ix + iw * 0.54, y, iw * 0.46);
  }
  y -= 8;

  // Plan drawing
  // Optional detail rows below the casting: structure size on its own row,
  // the rest two to a row. The plan drawing gives up the space they need.
  const pairs: [string, string][] = [];
  if (has('constructionType')) pairs.push(['CONSTRUCTION', s.constructionType || '—']);
  if (has('condition')) pairs.push(['CONDITION', s.condition || '—']);
  if (has('sump')) pairs.push(['SUMP', sumpText(s) || '—']);
  if (has('needsCleaning')) pairs.push(['NEEDS CLEANING', s.needsCleaning === true ? 'Yes' : s.needsCleaning === false ? 'No' : '—']);
  if (has('steps')) pairs.push(['STEPS', stepsText(s) || '—']);
  const detailRows = (has('structureSize') ? 1 : 0) + Math.ceil(pairs.length / 2);
  const drawH = Math.max(130, 200 - detailRows * 15 - (has('staOffset') ? 15 : 0) + 10);
  drawPlanSheet(page, f, s, ix, y - drawH, iw, drawH, netColor);
  y -= drawH + 14;

  // Rim / depth / coordinates
  const rim = num(s.rimElevation);
  const depth = num(s.depth);
  field(page, f, 'RIM ELEV.', rim === null ? '—' : rim.toFixed(2), ix, y, iw * 0.5, {bold: true});
  field(page, f, 'DEPTH', depth === null ? '—' : `${Math.abs(depth).toFixed(2)}'`, ix + iw * 0.54, y, iw * 0.46);
  y -= 15;
  const {northing, easting} = projectPoint(s.latitude, s.longitude, cs);
  const [nh, eh] = coordinateHeaders(cs);
  field(page, f, nh.startsWith('Lat') ? 'LAT' : 'N', northing || '—', ix, y, iw * 0.5);
  field(page, f, eh.startsWith('Lon') ? 'LONG' : 'E', easting || '—', ix + iw * 0.54, y, iw * 0.46);
  y -= 17;

  // Casting type (rectangle / square / round) and size
  const round = s.castingShape !== 'rectangular';
  const square = !round && s.castingWidth === s.castingLength;
  const hasCasting = !!s.castingWidth?.trim(); // nothing ticked if no size was recorded
  const ftv = (v: string) => (v?.trim() ? `${v.trim()}'` : '');
  drawText(page, f, 'CASTING TYPE', ix, y, {size: 6.5, bold: true, color: MUTED});
  const shapes: {kind: 'rect' | 'square' | 'round'; on: boolean}[] = [
    {kind: 'rect', on: hasCasting && !round && !square},
    {kind: 'square', on: hasCasting && square},
    {kind: 'round', on: hasCasting && round},
  ];
  let sx = ix + 72;
  for (const sh of shapes) {
    const col = sh.on ? SLATE : MUTED;
    const bw = sh.on ? 1.4 : 0.75;
    if (sh.kind === 'rect') page.drawRectangle({x: sx, y: y - 3, width: 22, height: 12, borderColor: col, borderWidth: bw, color: sh.on ? SLATE_LIGHT : WHITE});
    if (sh.kind === 'square') page.drawRectangle({x: sx + 4, y: y - 3, width: 12, height: 12, borderColor: col, borderWidth: bw, color: sh.on ? SLATE_LIGHT : WHITE});
    if (sh.kind === 'round') page.drawCircle({x: sx + 10, y: y + 3, size: 6.5, borderColor: col, borderWidth: bw, color: sh.on ? SLATE_LIGHT : WHITE});
    sx += 36;
  }
  y -= 15;
  const third = iw / 3;
  field(page, f, 'L', round ? '' : ftv(s.castingLength), ix, y, third - 6);
  field(page, f, 'W', round ? '' : ftv(s.castingWidth), ix + third, y, third - 6);
  field(page, f, 'DIA', round ? ftv(s.castingWidth) : '', ix + 2 * third, y, third);
  y -= 16;

  // Optional details
  if (has('structureSize')) {
    field(page, f, 'STRUCTURE SIZE', structureSizeText(s) || '—', ix, y, iw);
    y -= 15;
  }
  for (let k = 0; k < pairs.length; k += 2) {
    field(page, f, pairs[k][0], pairs[k][1], ix, y, iw * 0.5);
    if (pairs[k + 1]) field(page, f, pairs[k + 1][0], pairs[k + 1][1], ix + iw * 0.54, y, iw * 0.46);
    y -= 15;
  }
  if (detailRows > 0) y -= 1;

  // Pipe table
  const pcols = [
    {h: '#', w: 0.08},
    {h: 'DIR', w: 0.11},
    {h: 'SIZE', w: 0.17},
    {h: 'MATERIAL', w: 0.2},
    {h: 'DEPTH', w: 0.2, right: true},
    {h: 'INVERT', w: 0.24, right: true},
  ];
  page.drawRectangle({x: ix, y: y - 3, width: iw, height: 12, color: SLATE});
  let px = ix + 3;
  for (const c of pcols) {
    const cw = c.w * (iw - 6);
    drawText(page, f, c.h, c.right ? px + cw - 3 : px, y, {size: 6.5, bold: true, color: WHITE, align: c.right ? 'right' : 'left'});
    px += cw;
  }
  y -= 11;
  // Comments box shrinks (58 → 36) when that lets more pipes fit in the table
  const ROW = 10;
  const rowsFor = (ch: number) => Math.max(1, Math.floor((y - (bottom + ch + 12)) / ROW));
  const commentsH = s.pipes.length > rowsFor(58) ? 36 : 58;
  const maxRows = rowsFor(commentsH);
  const shown = s.pipes.slice(0, s.pipes.length > maxRows ? maxRows - 1 : maxRows);
  if (s.pipes.length === 0) {
    drawText(page, f, 'No pipes recorded', ix + 3, y, {size: 7.5, color: MUTED});
    y -= ROW;
  }
  shown.forEach((p, i) => {
    if (i % 2 === 1) page.drawRectangle({x: ix, y: y - 3, width: iw, height: ROW, color: rgb(0.97, 0.97, 0.98)});
    const d = pipeDepth(p);
    const inv = invertOf(s, p);
    const cells = [
      String(i + 1),
      p.direction,
      p.size || '—',
      p.material || '—',
      d === null ? '—' : `-${d.toFixed(2)}`,
      inv === null ? '—' : inv.toFixed(2),
    ];
    let qx = ix + 3;
    cells.forEach((cell, ci) => {
      const c = pcols[ci];
      const cw = c.w * (iw - 6);
      drawText(page, f, cell, c.right ? qx + cw - 3 : qx, y, {size: 7.5, bold: ci === 0, align: c.right ? 'right' : 'left', maxWidth: cw - 3});
      qx += cw;
    });
    y -= ROW;
  });
  if (shown.length < s.pipes.length) {
    drawText(page, f, `+ ${s.pipes.length - shown.length} more pipe(s) — see CSV export`, ix + 3, y, {size: 7, color: MUTED});
    y -= ROW;
  }

  // Comments
  const cTop = bottom + commentsH + 4;
  drawText(page, f, 'COMMENTS', ix, cTop, {size: 6.5, bold: true, color: MUTED});
  page.drawRectangle({x: ix, y: bottom + 6, width: iw, height: commentsH - 8, color: rgb(0.97, 0.97, 0.98), borderColor: LINE, borderWidth: 0.5});
  const lines = s.notes
    ? wrap(f.regular, f.safe(s.notes), 7.5, iw - 8, Math.max(1, Math.floor((commentsH - 14) / 9.5)))
    : [];
  lines.forEach((line, i) => drawText(page, f, line, ix + 4, bottom + commentsH - 12 - i * 9.5, {size: 7.5}));
}

/**
 * Top-down (plan) view: the structure in the centre — circle if round, square if
 * rectangular — with each pipe drawn outward in its compass direction (north up).
 */
function drawPlanSheet(page: PDFPage, f: Fonts, s: Structure, x: number, y: number, w: number, h: number, net: RGB) {
  page.drawRectangle({x, y, width: w, height: h, borderColor: LINE, borderWidth: 0.5});

  // North indicator (bottom-left, like the field form)
  const nx = x + 16;
  const ny = y + 16;
  page.drawCircle({x: nx, y: ny, size: 9, borderColor: TEXT, borderWidth: 0.8});
  page.drawSvgPath('M 0 -7 L 3.5 3 L 0 1 L -3.5 3 Z', {x: nx, y: ny, color: TEXT});
  drawText(page, f, 'NORTH', nx, ny + 13, {size: 6.5, bold: true, align: 'center'});

  const cx = x + w / 2;
  const cy = y + h / 2;
  const round = s.castingShape !== 'rectangular';
  const R = 24; // circle radius / half side of square
  // Pipe length from centre, leaving room past the tag for the label:
  // wide labels to the sides (size/material, invert), two lines above/below
  const LX = w / 2 - 60;
  const LY = h / 2 - 40;

  // Group pipes by direction so pipes going the same way sit side by side
  const byDir = new Map<string, number[]>();
  s.pipes.forEach((p, i) => {
    const list = byDir.get(p.direction) ?? [];
    list.push(i);
    byDir.set(p.direction, list);
  });

  byDir.forEach((indexes, dir) => {
    const a = ((DIR_ANGLE[dir] ?? 0) * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = Math.cos(a);
    const px = -dy; // perpendicular
    const py = dx;
    // Fit the pipe inside an ellipse with half-axes LX (sideways) and LY (up/down)
    const L = 1 / Math.sqrt((dx / LX) ** 2 + (dy / LY) ** 2);
    indexes.forEach((pi, k) => {
      const off = ((indexes.length - 1) / 2 - k) * 17;
      const ox = px * off;
      const oy = py * off;
      const ex = cx + ox + dx * L;
      const ey = cy + oy + dy * L;
      page.drawLine({start: {x: cx + ox, y: cy + oy}, end: {x: ex, y: ey}, thickness: 4, color: SLATE});
      // Numbered tag at the end
      const tx = cx + ox + dx * (L + 8);
      const ty = cy + oy + dy * (L + 8);
      page.drawCircle({x: tx, y: ty, size: 7, color: WHITE, borderColor: SLATE, borderWidth: 1});
      drawText(page, f, String(pi + 1), tx, ty - 2.6, {size: 7, bold: true, align: 'center'});

      // Label beyond the tag: size + material, then invert (or depth if no rim)
      const pipe = s.pipes[pi];
      const lines: string[] = [];
      const sizeMat = [pipe.size, pipe.material].filter(Boolean).join(' ');
      if (sizeMat) lines.push(sizeMat);
      const inv = invertOf(s, pipe);
      const d = pipeDepth(pipe);
      if (inv !== null) lines.push(`INV ${inv.toFixed(2)}`);
      else if (d !== null) lines.push(`-${d.toFixed(2)}`); // no rim elevation: show the depth
      if (lines.length === 0) return;

      const LH = 8; // line height
      const blockH = lines.length * LH;
      let lx = tx + Math.sign(dx) * 11;
      let align: 'left' | 'right' | 'center' = dx > 0.3 ? 'left' : dx < -0.3 ? 'right' : 'center';
      let topY: number; // baseline of the first line
      if (indexes.length > 1 && Math.abs(dx) < 0.3) {
        // side-by-side vertical pipes: labels past the tags, spread outward
        // (the left-hand pipe's label runs left, the right-hand one's runs right)
        const onLeft = ox < 0;
        lx = onLeft ? tx + 6 : tx - 6;
        align = onLeft ? 'right' : 'left';
        topY = dy > 0 ? ty + 10 + blockH - LH : ty - 10 - LH + 2.5;
      } else if (align === 'center') {
        // straight up / down: stack above (N) or below (S) the tag
        topY = dy > 0 ? ty + 10 + blockH - LH : ty - 10 - LH + 2.5;
      } else {
        const cyBlock = ty + dy * 10; // nudge up/down for diagonal pipes
        topY = cyBlock + blockH / 2 - LH + 2.5;
      }
      // Keep the label inside the drawing
      const room =
        align === 'left' ? x + w - 3 - lx : align === 'right' ? lx - x - 3 : w - 6;
      lines.forEach((t, li) => {
        drawText(page, f, t, lx, topY - li * LH, {
          size: 7,
          bold: li === 0,
          color: SLATE,
          align,
          maxWidth: Math.max(20, room),
        });
      });
    });
  });

  // Structure at the centre (drawn over the pipe ends)
  if (round) {
    page.drawCircle({x: cx, y: cy, size: R, color: WHITE, borderColor: net, borderWidth: 2});
  } else {
    page.drawRectangle({x: cx - R, y: cy - R, width: 2 * R, height: 2 * R, color: WHITE, borderColor: net, borderWidth: 2});
  }
  drawText(page, f, s.structureId, cx, cy - 3, {size: 7.5, bold: true, align: 'center', maxWidth: 2 * R - 6});
}
