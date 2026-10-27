import { parseCSV, parseSeconds, parseSampleCSV } from './csv';
import { MAX_RUN_SECONDS } from '../model/limits';
import { fileEaseMessages as m } from '../ui/messages/fileEase';

export type CSVTimeUnit = 'seconds' | 'minutes' | 'hours';
export interface SampleCSVTable { kind: 'arrival' | 'service'; headers: string[]; rows: string[][] }
export interface MappedSampleCSV {
  values: number[]; canonicalCSV: string; column: number; unit: CSVTimeUnit;
  previewRows: { row: number; original: string; seconds: number }[];
}
const units: Record<CSVTimeUnit, number> = { seconds: 1, minutes: 60, hours: 3600 };
export function inspectSampleCSV(text: string, kind: 'arrival' | 'service'): SampleCSVTable {
  const maximum = kind === 'arrival' ? 100_000 : 10_000;
  const rows = parseCSV(text, maximum + 1);
  if (!rows[0]?.length || rows.length < 2) throw new Error(m.missingHeader);
  for (let index = 1; index < rows.length; index++) if (rows[index].length !== rows[0].length) throw new Error(m.invalidRowWidth(index + 1));
  return { kind, headers: rows[0], rows: rows.slice(1) };
}
/** Canonical strict parser forbids exponent notation; preserve small converted doubles
 * using a plain decimal spelling instead of loosening that import boundary. */
export function plainDecimal(value: number): string {
  const text = String(value); if (!/[eE]/.test(text)) return text;
  const [mantissa, exponent] = text.toLowerCase().split('e'); const digits = mantissa.replace('.', '');
  const point = (mantissa.includes('.') ? mantissa.indexOf('.') : mantissa.length) + Number(exponent);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}
/** Deliberate column/unit mapping. All selected rows survive, in original order,
 * and the converted text must still pass the existing strict canonical parser. */
export function mapSampleCSV(table: SampleCSVTable, column: number, unit: CSVTimeUnit, horizon?: number): MappedSampleCSV {
  if (!Number.isSafeInteger(column) || column < 0 || column >= table.headers.length) throw new Error(m.invalidColumn);
  if (!Object.hasOwn(units, unit)) throw new Error(m.invalidUnit);
  const scale = units[unit], maximum = table.kind === 'arrival' ? MAX_RUN_SECONDS : 604800;
  const rowLimit = table.kind === 'arrival' ? 100_000 : 10_000;
  if (!table.rows.length) throw new Error(m.missingHeader);
  if (table.rows.length > rowLimit) throw new Error(m.rowLimit(rowLimit));
  const seconds = table.rows.map((row, index) => {
    if (row.length !== table.headers.length) throw new Error(m.invalidRowWidth(index + 2));
    const number = parseSeconds(row[column], index + 2, table.kind === 'arrival', maximum / scale);
    const value = number * scale;
    if (number > 0 && value === 0) throw new Error(m.precisionLoss(index + 2));
    if (!Number.isFinite(value) || value < 0 || value > maximum) throw new Error(m.convertedOverflow(index + 2));
    return value;
  });
  const canonicalCSV = `${table.kind === 'arrival' ? 'arrival_seconds' : 'service_seconds'}\r\n${seconds.map(plainDecimal).join('\r\n')}\r\n`;
  const values = parseSampleCSV(canonicalCSV, table.kind, horizon);
  return { values, canonicalCSV, column, unit, previewRows: table.rows.slice(0, 5).map((row, index) => ({ row: index + 2, original: row[column], seconds: values[index] })) };
}
