import type { RunResult } from '../model/types';
import { encodeCSV } from './csv';
import { exportErrorMessages as messages } from '../ui/messages/exportErrors';

export function resultRows(result: RunResult): unknown[][] {
  const s = result.summary;
  const rows: unknown[][] = [['section', 'metric', 'value', 'unit', 'scope'],
    ['identity', 'run_id', result.id, '', 'run snapshot'], ['identity', 'engine_version', result.engineVersion, '', 'run snapshot'],
    ['identity', 'rng_version', result.provenance.rngVersion, '', 'actual run RNG'],
    ['identity', 'model_hash', result.modelHash, '', 'run snapshot'], ['identity', 'demand_hash', result.demandHash, '', 'run snapshot'],
    ['identity', 'seed', result.seed, '', 'run snapshot'], ['identity', 'status', result.status, '', result.reason ?? ''],
    ['identity', 'simulated_until', result.simulatedUntil, 'seconds', 'processed interval'],
    ['identity', 'horizon', result.model.horizon, 'seconds', 'requested interval'], ['identity', 'warmup', result.model.warmup, 'seconds', 'run snapshot'],
    ['identity', 'sla_wait_target', result.model.slaSeconds, 'seconds', 'run snapshot'],
    ['identity', 'measurement_start', s.measurementStart, 'seconds', 'measurement window'], ['identity', 'measurement_end', s.measurementEnd, 'seconds', 'measurement window'],
    ['identity', 'cohort', 'Arrivals in [warmup, horizon); outcomes observed only until simulated_until; horizon is not drained.', '', 'cohort'],
    ['identity', 'wait_population', 'Summary/class waits: total wait of completed cohort entities. Station waits: completed service visits of cohort entities. Unfinished waits are censored, not zero.', '', 'wait samples'],
    ['identity', 'sla_population', 'Completed cohort entities meeting the total-wait target / all cohort arrivals, including unfinished and abandoned.', '', 'SLA denominator'],
    ['identity', 'time_integrals', 'Queue, busy and cost integrals include all work during the measurement window, including work arriving before warm-up. Cost = scheduled unit-hours × regular rate + overtime unit-hours × overtime rate.', '', 'time-window population'],
    ['identity', 'trace_complete', result.trace.complete, '', `Trace through ${result.trace.until} seconds; numerical metrics do not depend on trace completeness.`],
    ['identity', 'forecast', 'Synthetic model run; no validated real-world forecast.', '', 'assumption']];
  for (const [metric, value] of Object.entries(result.provenance.limits)) rows.push(['limits', metric, value, 'count', 'effective numeric cap; zero is a literal cap, not unlimited']);
  for (const [metric, unit] of [['arrivals', 'entities'], ['completed', 'entities'], ['balked', 'entities'], ['reneged', 'entities'], ['inSystem', 'entities'], ['meanWait', 'seconds'], ['p50Wait', 'seconds'], ['p95Wait', 'seconds'], ['meanSojourn', 'seconds'], ['slaMet', 'entities'], ['slaRate', 'fraction'], ['throughputPerHour', 'entities/hour'], ['cost', result.model.currency], ['waitSampleSize', 'completed entities']] as const) rows.push(['summary', metric, ['meanWait', 'p50Wait', 'p95Wait', 'meanSojourn'].includes(metric) && !s.waitSampleSize ? null : s[metric], unit, !s.waitSampleSize && ['meanWait', 'p50Wait', 'p95Wait', 'meanSojourn'].includes(metric) ? 'unavailable: no completed-cohort observations' : result.status === 'completed' ? 'full run' : 'incomplete run; not a completed comparison']);
  for (const station of result.stations) {
    rows.push(['station', 'label', result.model.nodes.find(n => n.id === station.nodeId)?.label ?? station.nodeId, '', station.nodeId]);
    for (const [metric, unit] of [['arrived', 'visits'], ['started', 'visits'], ['finished', 'visits'], ['balked', 'visits'], ['reneged', 'visits'], ['queueAtEnd', 'entities'], ['busyAtEnd', 'entities'], ['averageQueue', 'entities'], ['averageWait', 'seconds'], ['p95Wait', 'seconds'], ['utilization', 'fraction'], ['busySeconds', 'server-seconds']] as const) rows.push(['station', metric, ['averageWait', 'p95Wait'].includes(metric) && !station.finished ? null : station[metric], unit, station.nodeId]);
  }
  for (const pool of result.pools) {
    rows.push(['resource', 'label', result.model.resources.find(p => p.id === pool.poolId)?.label ?? pool.poolId, '', pool.poolId]);
    for (const [metric, unit] of [['scheduledUnitSeconds', 'unit-seconds'], ['busyUnitSeconds', 'unit-seconds'], ['overtimeUnitSeconds', 'unit-seconds'], ['cost', result.model.currency], ['utilization', 'fraction']] as const) rows.push(['resource', metric, pool[metric], unit, pool.poolId]);
  }
  for (const item of result.classes) for (const [metric, unit] of [['arrivals', 'entities'], ['completed', 'entities'], ['balked', 'entities'], ['reneged', 'entities'], ['inSystem', 'entities'], ['meanWait', 'seconds'], ['waitSampleSize', 'completed entities']] as const) rows.push(['class', metric, metric === 'meanWait' && !item.waitSampleSize ? null : item[metric], unit, item.classId]);
  rows.push(['wait_distribution', 'sample_size', result.waitDistribution.sampleSize, 'completed entities', 'full completed-cohort observations; independent of replay retention']);
  for (const bin of result.waitDistribution.bins) rows.push(['wait_distribution', 'bin_count', bin.count, 'completed entities', `[${bin.from}, ${bin.to === null ? 'infinity' : bin.to}) seconds`]);
  for (const warning of result.warnings) rows.push(['warning', 'engine_warning', warning, '', 'run snapshot']);
  for (const [metric, value] of Object.entries(result.diagnostics)) rows.push(['diagnostic', metric, value, 'count', 'all entities, including warm-up arrivals']);
  if (result.reason) rows.push(['warning', 'termination_reason', result.reason, '', 'run snapshot']);
  return rows;
}
export function resultCSV(result: RunResult): string { return encodeCSV(resultRows(result)); }
function html(value: unknown): string { return String(value ?? '—').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!)); }

function metricTableGroups(rows: unknown[][]): string {
  const columns = '<colgroup><col style="width:14%"><col style="width:22%"><col style="width:27%"><col style="width:12%"><col style="width:25%"></colgroup>';
  const heading = `<thead><tr>${rows[0].map(value => `<th scope="col">${html(value)}</th>`).join('')}</tr></thead>`;
  const groups: string[] = [];
  // Short block wrappers keep column labels with their data in print engines
  // that split table rows or omit headers on later table fragments.
  for (let first = 1; first < rows.length; first += 8) {
    const body = rows.slice(first, first + 8).map(row => `<tr>${row.map(value => `<td>${html(value)}</td>`).join('')}</tr>`).join('');
    groups.push(`<div class="metric-block"><table aria-labelledby="run-metrics-heading">${columns}${heading}<tbody>${body}</tbody></table></div>`);
  }
  return groups.join('');
}

/** Self-contained print document; every value comes from the immutable run, never the current draft. */
export function resultReportHTML(result: RunResult): string {
  const rows = resultRows(result);
  const s = result.summary;
  const cards = [
    ['Arrivals', s.arrivals.toLocaleString('en')], ['Completed', s.completed.toLocaleString('en')], ['Still in process', s.inSystem.toLocaleString('en')],
    ['Mean completed-cohort wait', s.waitSampleSize ? `${(s.meanWait / 60).toFixed(1)} minutes` : null],
    ['95th percentile wait', s.waitSampleSize ? `${(s.p95Wait / 60).toFixed(1)} minutes` : null],
    ['Resource cost', s.cost.toLocaleString('en', { style: 'currency', currency: result.model.currency })],
  ];
  const summary = `<dl class="summary">${cards.map(([label, value]) => `<div><dt>${html(label)}</dt><dd>${html(value)}</dd></div>`).join('')}</dl>`;
  const max = Math.max(1, ...result.waitDistribution.bins.map(b => b.count));
  const histogram = result.waitDistribution.sampleSize ? `<figure style="max-width:760px;margin:28px 0"><figcaption>Waiting time · ${html(result.waitDistribution.sampleSize)} completed-cohort observations</figcaption><svg viewBox="0 0 660 190" role="img" aria-label="Waiting distribution">${result.waitDistribution.bins.map((bin, i) => { const x = 28 + i * 68; const height = bin.count / max * 120; return `<rect x="${x}" y="${150 - height}" width="43" height="${height}" rx="3" fill="#81986c"/><text x="${x + 21.5}" y="${Math.max(15, 143 - height)}" text-anchor="middle" fill="#3e5d31" font-size="11">${bin.count}</text><text x="${x + 21.5}" y="173" text-anchor="middle" fill="#5c744d" font-size="10">${html(bin.to === null ? `${bin.from}s+` : `${bin.from}–${bin.to}s`)}</text>`; }).join('')}</svg><p>Half-open waiting-time bins in seconds. The final bin has no upper bound. Unfinished work is not assigned zero wait.</p></figure>` : '<p>No completed-cohort waiting observations. Mean wait and percentiles are unavailable.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QueueLab — ${html(result.model.name)}</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#263b31;max-width:1000px;margin:40px auto;padding:0 24px}h1{font-weight:600}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px 16px;padding:22px 0;border-top:1px solid #d2d9ce;border-bottom:1px solid #d2d9ce;break-inside:avoid}.summary dt{font-size:11px;color:#53684a}.summary dd{margin:6px 0 0;font-size:23px;font-weight:600}.details-heading{margin-top:36px}figure{break-inside:avoid}p{max-width:80ch}table{width:100%;table-layout:fixed;border-collapse:collapse;margin-top:0;font-size:11px}.metric-block{margin-top:24px}th,td{text-align:left;border-bottom:1px solid #d2d9ce;padding:7px;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}.status{font-size:17px;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:10px/1.5 ui-monospace,monospace}@media(max-width:600px){.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.summary dd{font-size:19px}}@media print{@page{margin:14mm}body{margin:0;padding:0}.metric-block{break-inside:avoid;page-break-inside:avoid}thead{break-inside:avoid;page-break-inside:avoid}tr{page-break-inside:avoid}.details-heading{break-before:page}button{display:none}details{break-before:page}}</style></head><body><h1>${html(result.model.name)}</h1><p class="status">${result.status === 'completed' ? 'Completed model run' : `INCOMPLETE RUN — ${html(result.status)}`}</p><p>${result.status === 'completed' ? 'Full requested horizon processed. ' : 'This run did not finish the requested horizon. These partial observations must not be presented as a completed result or compared as a full run. '}${html(result.reason ?? '')}</p><p>All times are seconds unless labeled otherwise. Currency: ${html(result.model.currency)}. Synthetic model run; assumptions have not been validated as a real-world forecast. The run snapshot below may differ from the current draft.</p>${summary}${histogram}<h2 class="details-heading" id="run-metrics-heading">Detailed metrics &amp; run identity</h2>${metricTableGroups(rows)}<details open><summary>Exact model snapshot used by this run</summary><pre>${html(JSON.stringify(result.model, null, 2))}</pre></details></body></html>`;
}

export function printResult(result: RunResult): void {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error(messages.printWindowBlocked);
  popup.opener = null;
  const reportDocument = popup.document;
  reportDocument.open(); reportDocument.write(resultReportHTML(result)); reportDocument.close();
  const isReportOpen = () => {
    try { return !popup.closed && popup.document === reportDocument; }
    catch { return false; } // The owner may have navigated the report tab elsewhere.
  };
  let scheduled = false;
  const print = () => {
    if (scheduled || !isReportOpen()) return;
    scheduled = true;
    popup.focus();
    // A completed document can still have pending font/layout work. Start print
    // in a later task after that work, without relying on a fixed delay or RAF.
    void reportDocument.fonts.ready.then(() => {
      if (!isReportOpen()) return;
      popup.setTimeout(() => { if (isReportOpen()) popup.print(); }, 0);
    });
  };
  popup.addEventListener('load', print, { once: true });
  // document.write may already have completed its load synchronously.
  if (reportDocument.readyState === 'complete') print();
}
