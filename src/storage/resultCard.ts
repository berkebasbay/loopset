import type { RunResult } from '../model/types';
import { safeFilename } from './csv';

interface CardMetric { readonly label: string; readonly value: string; readonly detail: string }
export interface ResultCardContent {
  readonly name: string;
  readonly incomplete: boolean;
  readonly status: string;
  readonly observation: string;
  readonly reason: string;
  readonly run: string;
  readonly seed: string;
  readonly engine: string;
  readonly randomness: string;
  readonly limits: string;
  readonly fingerprints: string;
  readonly coverage: string;
  readonly assumptions: string;
  readonly population: string;
  readonly scope: string;
  readonly filename: string;
  readonly metrics: readonly CardMetric[];
}

const number = (value: number) => value !== 0 && Math.abs(value) < 0.01
  ? value.toPrecision(3) : value.toLocaleString('en', { maximumFractionDigits: 2 });
const seconds = (value: number) => `${number(value)} s`;
const waitingTime = (value: number) => value >= 3600 ? `${number(value / 3600)} h`
  : value >= 60 ? `${number(value / 60)} min` : seconds(value);

/** Capture primitive display values before asynchronous font/PNG work. No draft or layout is accepted. */
export function resultCardContent(result: RunResult): ResultCardContent {
  const s = result.summary;
  const incomplete = result.status !== 'completed';
  const window = result.simulatedUntil < result.model.warmup
    ? `Stopped before warm-up ${seconds(result.model.warmup)}; no measurement interval`
    : `Window [${number(s.measurementStart)}, ${number(s.measurementEnd)}] s · warm-up ${seconds(result.model.warmup)}`;
  const metrics: CardMetric[] = [
    { label: 'Arrivals', value: number(s.arrivals), detail: 'Observed cohort arrivals' },
    { label: 'Completed', value: number(s.completed), detail: 'Completed cohort entities' },
    { label: 'Still in process', value: number(s.inSystem), detail: 'Unfinished cohort entities at stop' },
    { label: 'Mean wait · completed cohort', value: s.waitSampleSize ? waitingTime(s.meanWait) : 'Unavailable', detail: s.waitSampleSize ? `n = ${number(s.waitSampleSize)} completed-cohort entities` : 'n = 0 · no completed-cohort observations' },
    { label: `Resource cost · ${result.model.currency}`, value: s.cost !== 0 && Math.abs(s.cost) < 0.01 ? s.cost.toPrecision(3) : s.cost.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), detail: 'Scheduled capacity + overtime' },
    { label: 'Balked / left queue', value: `${number(s.balked)} / ${number(s.reneged)}`, detail: 'Separate observed cohort outcomes' },
  ];
  return Object.freeze({
    name: result.model.name,
    incomplete,
    status: incomplete ? `INCOMPLETE RUN · ${result.status.toUpperCase()}` : 'COMPLETED RUN',
    observation: `Processed 0–${seconds(result.simulatedUntil)} / requested 0–${seconds(result.model.horizon)}`,
    reason: incomplete ? result.reason ?? 'Requested horizon not fully processed; do not use as a full-run comparison.' : 'Observed results from the sealed run snapshot',
    run: `Run ${result.id}`, seed: `Seed ${result.seed}`, engine: `Engine ${result.engineVersion}`,
    randomness: `RNG ${result.provenance.rngVersion}`,
    limits: `Limits · maxEvents ${result.provenance.limits.maxEvents} · maxEntities ${result.provenance.limits.maxEntities} · maxMicrosteps ${result.provenance.limits.maxMicrosteps} · trace entities ${result.provenance.limits.maxTraceEntities} · trace events ${result.provenance.limits.maxTraceEvents}`,
    fingerprints: `Model ${result.modelHash} · Demand ${result.demandHash}`,
    coverage: `${window} · replay ${result.trace.complete ? 'complete' : 'prefix'} through ${seconds(result.trace.until)}`,
    assumptions: 'Single run · uncertainty not estimated · model assumptions unvalidated.',
    population: `Cohort arrivals [${number(result.model.warmup)}, ${number(result.model.horizon)}) s; wait uses completed-cohort entities. No horizon drain.`,
    scope: incomplete ? 'Partial numerical results only. Unfinished waits are censored, not zero; replay coverage is separate.' : 'Unfinished waits are censored, not zero. Numerical results and replay coverage are separate.',
    // Keep the incomplete marker before a possibly long model name, even after filename truncation.
    filename: safeFilename(`queuelab-${incomplete ? 'incomplete-' : ''}${result.status}-${result.id}-${result.model.name}`, 'png'),
    metrics: Object.freeze(metrics.map(metric => Object.freeze(metric))),
  });
}

const WIDTH = 1280; const HEIGHT = 640;
const INK = '#293b33'; const PAPER = '#f6f5f0'; const MUTED = '#5c6a60'; const ACCENT = '#bb512e';
const FONT = '"DM Sans", system-ui, sans-serif';

/** Fit literal Unicode text; truncate only at grapheme boundaries, never by HTML or SVG markup. */
function text(context: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, size: number, color = INK, weight = 400, minimum = size): void {
  const literal = value.replace(/[\r\n\t]/g, ' ');
  context.fillStyle = color;
  let fontSize = size;
  const setFont = () => { context.font = `${weight} ${fontSize}px ${FONT}`; };
  setFont();
  while (fontSize > minimum && context.measureText(literal).width > width) { fontSize--; setFont(); }
  let fitted = literal;
  if (context.measureText(fitted).width > width) {
    const segments = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(literal), part => part.segment);
    let low = 0; let high = segments.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (context.measureText(`${segments.slice(0, middle).join('')}…`).width <= width) low = middle; else high = middle - 1;
    }
    fitted = `${segments.slice(0, low).join('')}…`;
  }
  context.fillText(fitted, x, y);
}

function paintResultCard(context: CanvasRenderingContext2D, content: ResultCardContent): void {
  context.fillStyle = PAPER; context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = ACCENT; context.fillRect(56, 30, 7, 27);
  text(context, 'QueueLab', 78, 53, 340, 28, INK, 700);
  text(context, 'RESULT SNAPSHOT · LOCAL EXPORT', 890, 49, 334, 13, MUTED, 600);
  text(context, content.name, 56, 108, 1168, 36, INK, 650, 24);
  text(context, content.status, 56, 143, 440, 16, content.incomplete ? ACCENT : INK, 750);
  text(context, content.reason, 508, 143, 716, 14, MUTED, 400);
  text(context, content.observation, 56, 171, 1168, 15, MUTED, 500);
  context.strokeStyle = '#d6ddd2'; context.lineWidth = 1;
  context.beginPath(); context.moveTo(56, 189); context.lineTo(1224, 189); context.moveTo(56, 313); context.lineTo(1224, 313); context.stroke();
  for (const [index, metric] of content.metrics.entries()) {
    const x = 56 + (index % 3) * 400; const y = index < 3 ? 218 : 341;
    text(context, metric.label, x, y, 368, 16, MUTED, 500);
    text(context, metric.value, x, y + 49, 368, index < 3 ? 48 : 38, INK, 650, 27);
    text(context, metric.detail, x, y + 75, 368, 13, MUTED, 400);
  }
  context.fillStyle = INK; context.fillRect(0, 439, WIDTH, HEIGHT - 439);
  text(context, content.run, 56, 464, 416, 14, PAPER, 600);
  text(context, content.seed, 500, 464, 350, 14, PAPER, 600);
  text(context, content.engine, 910, 464, 314, 14, PAPER, 600);
  text(context, content.fingerprints, 56, 486, 1168, 14, PAPER, 500);
  text(context, content.randomness, 56, 508, 1168, 14, PAPER, 500);
  text(context, content.limits, 56, 530, 1168, 13, PAPER, 400, 12);
  text(context, content.coverage, 56, 552, 1168, 13, PAPER, 400, 12);
  context.strokeStyle = '#5c7062'; context.beginPath(); context.moveTo(56, 562); context.lineTo(1224, 562); context.stroke();
  text(context, content.assumptions, 56, 582, 1168, 13, '#f2c9af', 500);
  text(context, content.population, 56, 603, 1168, 13, PAPER);
  text(context, content.scope, 56, 624, 1168, 13, PAPER);
}

export async function resultCardPNG(result: RunResult): Promise<{ blob: Blob; filename: string }> {
  const content = resultCardContent(result);
  // This is the application's bundled local face; the system fallback is also local if font loading fails.
  let fontDeadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([document.fonts.load('650 36px "DM Sans"'), document.fonts.load('400 14px "DM Sans"')]),
      new Promise<void>(resolve => { fontDeadline = setTimeout(resolve, 1500); }),
    ]);
  } catch { /* Canvas uses its local system fallback. */ }
  finally { clearTimeout(fontDeadline); }
  const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not create a result image. Download the CSV or HTML report instead.');
  paintResultCard(context, content);
  let encodingDeadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      encodingDeadline = setTimeout(() => reject(new Error('PNG encoding timed out. Try again or download the CSV or HTML report.')), 5000);
      canvas.toBlob(value => {
        if (!value || !value.size || value.type !== 'image/png') reject(new Error('The browser could not encode the result PNG. Download the CSV or HTML report instead.'));
        else resolve(value);
      }, 'image/png');
    });
    return { blob, filename: content.filename };
  } finally { clearTimeout(encodingDeadline); }
}

/** A requested file download is not an IndexedDB save or proof that a file was retained. */
export async function downloadResultPNG(result: RunResult): Promise<void> {
  const { blob, filename } = await resultCardPNG(result);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.hidden = true;
    document.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
