/** Strict RFC-4180-style CSV. No delimiter or decimal-locale guessing. */
import { MAX_RUN_SECONDS } from '../model/limits';
import { fileErrorMessages as messages } from '../ui/messages/fileErrors';
export const FILE_LIMIT = 5_000_000;
export const CSV_CELL_LIMIT = 65_536;

export function parseCSV(input: string, maxRows = 100_001): string[][] {
  if (new TextEncoder().encode(input).length > FILE_LIMIT) throw new Error(messages.csvTooLarge);
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(source)) throw new Error(messages.unsupportedCSVCharacters);
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let closed = false; let started = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; started = false; if (row.length > 100) throw new Error(messages.tooManyColumns); };
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > maxRows) throw new Error(messages.dataRowLimit(maxRows - 1)); };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === ',') pushCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && source[i + 1] === '\n') i++; pushRow(); }
    else if (c === '"') { if (started || closed) throw new Error(messages.unexpectedQuote(rows.length + 1)); quoted = true; started = true; }
    else { if (closed) throw new Error(messages.textAfterQuotedCell(rows.length + 1)); cell += c; started = true; }
    if (cell.length > CSV_CELL_LIMIT) throw new Error(messages.cellLimit(CSV_CELL_LIMIT));
  }
  if (quoted) throw new Error(messages.unclosedQuotedCell);
  if (started || closed || cell.length || row.length) pushRow();
  return rows;
}

/** Accepts plain decimal seconds only; grouping, decimal commas, units and exponents are rejected. */
export function parseSeconds(value: string, row: number, allowZero: boolean, maximum = 604800): number {
  const trimmed = value.trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) throw new Error(messages.plainSecondsRequired(row));
  const number = Number(trimmed);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0) || number > maximum) throw new Error(messages.secondsRange(row, allowZero, maximum));
  return number;
}

export function parseSampleCSV(text: string, kind: 'arrival' | 'service', horizon?: number): number[] {
  const header = kind === 'arrival' ? 'arrival_seconds' : 'service_seconds';
  const maximum = kind === 'arrival' ? 100_000 : 10_000;
  const rows = parseCSV(text, maximum + 1);
  if (rows[0]?.length !== 1 || rows[0][0].trim() !== header) throw new Error(messages.expectedSampleColumn(header));
  if (rows.length < 2) throw new Error(messages.missingSampleRows);
  const values = rows.slice(1).map((row, i) => {
    if (row.length !== 1) throw new Error(messages.expectedSingleColumn(i + 2));
    return parseSeconds(row[0], i + 2, kind === 'arrival', kind === 'arrival' ? MAX_RUN_SECONDS : 604800);
  });
  if (kind === 'arrival') values.forEach((value, i) => {
    if (horizon !== undefined && value >= horizon) throw new Error(messages.arrivalOutsideHorizon(i + 2, horizon));
    if (i && value < values[i - 1]) throw new Error(messages.arrivalsOutOfOrder(i + 2));
  });
  return values;
}

/** Prefix spreadsheet formulas before CSV quoting. Applies to every cell, including labels. */
export function escapeCSV(value: unknown): string {
  let cell = value === null || value === undefined ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(cell) || /^[\t\r\n]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}
export function encodeCSV(rows: unknown[][]): string { return '\ufeff' + rows.map(row => row.map(escapeCSV).join(',')).join('\r\n') + '\r\n'; }

export async function readLocalText(file: File): Promise<string> {
  if (file.size > FILE_LIMIT) throw new Error(messages.fileTooLarge);
  const bytes = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(messages.invalidFileEncoding); }
}

export function safeFilename(name: string, extension: string): string {
  const stem = name.normalize('NFKC').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'queuelab';
  return `${stem}.${extension.replace(/[^a-z0-9]/gi, '')}`;
}

export function downloadText(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
