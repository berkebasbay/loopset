/** Strict RFC-4180-style CSV. No delimiter or decimal-locale guessing. */
export const FILE_LIMIT = 5_000_000;
export const CSV_CELL_LIMIT = 65_536;

export function parseCSV(input: string, maxRows = 100_001): string[][] {
  if (new TextEncoder().encode(input).length > FILE_LIMIT) throw new Error('CSV files are limited to 5 MB.');
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(source)) throw new Error('CSV contains unsupported control characters or invalid UTF-8.');
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let closed = false; let started = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; started = false; if (row.length > 100) throw new Error('CSV rows may contain at most 100 columns.'); };
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > maxRows) throw new Error(`CSV is limited to ${maxRows - 1} data rows.`); };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === ',') pushCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && source[i + 1] === '\n') i++; pushRow(); }
    else if (c === '"') { if (started || closed) throw new Error(`Unexpected quote near CSV row ${rows.length + 1}.`); quoted = true; started = true; }
    else { if (closed) throw new Error(`Unexpected text after a quoted cell near CSV row ${rows.length + 1}.`); cell += c; started = true; }
    if (cell.length > CSV_CELL_LIMIT) throw new Error(`CSV cells are limited to ${CSV_CELL_LIMIT} characters.`);
  }
  if (quoted) throw new Error('CSV ends inside a quoted cell.');
  if (started || closed || cell.length || row.length) pushRow();
  return rows;
}

/** Accepts plain decimal seconds only; grouping, decimal commas, units and exponents are rejected. */
export function parseSeconds(value: string, row: number, allowZero: boolean): number {
  const trimmed = value.trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) throw new Error(`Row ${row}: use plain seconds with a decimal point, for example 12.5. No grouping, decimal commas or units.`);
  const number = Number(trimmed);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0) || number > 604800) throw new Error(`Row ${row}: seconds must be ${allowZero ? 'non-negative' : 'positive'} and no more than 604,800.`);
  return number;
}

export function parseSampleCSV(text: string, kind: 'arrival' | 'service', horizon?: number): number[] {
  const header = kind === 'arrival' ? 'arrival_seconds' : 'service_seconds';
  const maximum = kind === 'arrival' ? 100_000 : 10_000;
  const rows = parseCSV(text, maximum + 1);
  if (rows[0]?.length !== 1 || rows[0][0].trim() !== header) throw new Error(`Expected exactly one column named ${header}. Delimiter: comma; decimal mark: point.`);
  if (rows.length < 2) throw new Error('Provide at least one data row after the header.');
  const values = rows.slice(1).map((row, i) => {
    if (row.length !== 1) throw new Error(`Row ${i + 2}: expected one column. Decimal commas and extra columns are not supported.`);
    return parseSeconds(row[0], i + 2, kind === 'arrival');
  });
  if (kind === 'arrival') values.forEach((value, i) => {
    if (horizon !== undefined && value >= horizon) throw new Error(`Row ${i + 2}: arrival must be before the run ends (${horizon} seconds).`);
    if (i && value < values[i - 1]) throw new Error(`Row ${i + 2}: arrival times must be in non-decreasing order. Rows have not been sorted automatically.`);
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
  if (file.size > FILE_LIMIT) throw new Error('Files are limited to 5 MB.');
  const bytes = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('This file is not valid UTF-8. Export it as UTF-8 and try again.'); }
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
