import type { Project, SimulationModel, ValidationIssue } from './types';
import { MAX_ARRIVALS_PER_HOUR, MAX_RUN_SECONDS, MAX_WAITING_PLACES } from './limits';
import { validateFacility } from './facilityValidation';

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const facilityNodeIds = (model: unknown) => new Set<string>(object(model) && Array.isArray(model.nodes) ? model.nodes.filter(object).map(node => String(node.id)) : []);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v) && !['constructor', 'prototype', '__proto__'].includes(v);
const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 160;
const dense = (values: unknown[]) => {
  for (let i = 0; i < values.length; i++) if (!Object.hasOwn(values, i)) return false;
  return true;
};

export function validateModel(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' });
  if (!object(value)) return [{ path: 'model', message: 'The model must be an object.', severity: 'error' }];
  const m = value;
  if (!id(m.id) || !text(m.name)) error('model', 'A valid model ID and name are required.');
  if (!finite(m.horizon) || m.horizon <= 0 || m.horizon > MAX_RUN_SECONDS) error('horizon', 'Run length must be positive and no longer than 365 days.');
  if (!finite(m.warmup) || m.warmup < 0 || !finite(m.horizon) || m.warmup >= m.horizon) error('warmup', 'Warm-up must be non-negative and shorter than the run.');
  if (!finite(m.seed) || !Number.isSafeInteger(m.seed)) error('seed', 'Seed must be a safe integer.');
  if (!finite(m.slaSeconds) || m.slaSeconds < 0) error('slaSeconds', 'The wait target must be a non-negative number of seconds.');
  if (typeof m.currency !== 'string' || !/^[A-Z]{3}$/.test(m.currency)) error('currency', 'Currency must be a three-letter code.');
  if (!Array.isArray(m.nodes) || m.nodes.length < 2 || m.nodes.length > 100 || !dense(m.nodes)) {
    error('nodes', 'A model needs 2–100 process nodes.'); return issues;
  }
  if (!Array.isArray(m.resources) || m.resources.length > 50 || !dense(m.resources)) { error('resources', 'Resources must be a list of at most 50 pools.'); return issues; }
  const poolIds = new Set<string>();
  const installed = new Map<string, number>();
  for (const [i, p] of m.resources.entries()) {
    const at = `resources.${i}`;
    if (!object(p)) { error(at, 'Resource must be an object.'); continue; }
    if (!id(p.id) || poolIds.has(String(p.id))) error(`${at}.id`, 'Resource IDs must be valid and unique.');
    poolIds.add(String(p.id));
    if (!text(p.label)) error(`${at}.label`, 'Give this resource a name.');
    if (!finite(p.installedCapacity) || !Number.isInteger(p.installedCapacity) || p.installedCapacity < 1 || p.installedCapacity > 1000) error(`${at}.installedCapacity`, 'Installed capacity must be an integer from 1 to 1,000.');
    else installed.set(String(p.id), p.installedCapacity);
    if (!finite(p.capacity) || !Number.isInteger(p.capacity) || p.capacity < 0 || !finite(p.installedCapacity) || p.capacity > p.installedCapacity) error(`${at}.capacity`, 'Scheduled capacity cannot exceed installed capacity.');
    for (const field of ['costPerHour', 'overtimeCostPerHour']) if (!finite(p[field]) || p[field] < 0 || p[field] > 1e6) error(`${at}.${field}`, 'Hourly cost must be between 0 and 1,000,000.');
    if (!Array.isArray(p.calendar) || p.calendar.length > 200 || !dense(p.calendar)) error(`${at}.calendar`, 'A calendar can contain at most 200 periods.');
    else {
      let lastEnd = 0;
      p.calendar.forEach((s, j) => {
        if (!object(s) || !finite(s.start) || !finite(s.end) || s.start < lastEnd || s.end <= s.start || !finite(m.horizon) || s.end > m.horizon || !finite(s.capacity) || !Number.isInteger(s.capacity) || s.capacity < 0 || !finite(p.installedCapacity) || s.capacity > p.installedCapacity) error(`${at}.calendar.${j}`, 'Calendar periods must be ordered, non-overlapping and within the run, with valid capacity.');
        if (object(s) && finite(s.end)) lastEnd = s.end;
      });
    }
  }
  function distribution(v: unknown, at: string, zero: boolean) {
    if (!object(v)) { error(at, 'Choose a time distribution.'); return; }
    const validTime = (x: unknown) => finite(x) && (zero ? x >= 0 : x > 0) && x <= 604800;
    switch (v.kind) {
      case 'constant': if (!validTime(v.value)) error(at, `Time must be ${zero ? 'non-negative' : 'positive'} and no longer than 7 days.`); break;
      case 'exponential': if (!finite(v.mean) || v.mean <= 0 || v.mean > 604800) error(at, 'Mean time must be positive and no longer than 7 days.'); break;
      case 'triangular': if (!validTime(v.min) || !validTime(v.mode) || !validTime(v.max) || Number(v.min) > Number(v.mode) || Number(v.mode) > Number(v.max)) error(at, 'Use valid times with minimum ≤ most likely ≤ maximum.'); break;
      case 'empirical': if (!Array.isArray(v.values) || v.values.length === 0 || v.values.length > 10000 || !dense(v.values) || !v.values.every(validTime)) error(at, 'Provide 1–10,000 valid time samples.'); break;
      default: error(at, 'Unknown time distribution.');
    }
  }
  const nodeIds = new Set<string>(); const samples = new Set<string>();
  const nodes = new Map<string, Record<string, unknown>>();
  for (const [i, n] of m.nodes.entries()) {
    const at = `nodes.${i}`;
    if (!object(n)) { error(at, 'Node must be an object.'); continue; }
    if (!id(n.id) || nodeIds.has(String(n.id))) error(`${at}.id`, 'Node IDs must be valid and unique.');
    if (!id(n.samplingId) || samples.has(String(n.samplingId))) error(`${at}.samplingId`, 'Sampling identities must be valid and unique.');
    nodeIds.add(String(n.id)); samples.add(String(n.samplingId)); nodes.set(String(n.id), n);
    if (!text(n.label)) error(`${at}.label`, 'Give this step a name.');
    if (n.kind === 'source') {
      if (!object(n.arrival)) error(`${at}.arrival`, 'Choose an arrival pattern.');
      else if (n.arrival.kind === 'fixed') { if (!finite(n.arrival.perHour) || n.arrival.perHour < 0 || n.arrival.perHour > MAX_ARRIVALS_PER_HOUR) error(`${at}.arrival`, 'Arrivals per hour must be between 0 and 10,000,000.'); }
      else if (n.arrival.kind === 'schedule') {
        const times = n.arrival.times;
        if (!Array.isArray(times) || times.length > 100000 || !dense(times) || times.some((t, k) => !finite(t) || t < 0 || !finite(m.horizon) || t >= m.horizon || (k > 0 && Number(times[k - 1]) > t))) error(`${at}.arrival.times`, 'Arrival times must be ordered, non-negative, before the run ends, and limited to 100,000 rows.');
      } else if (n.arrival.kind === 'poisson') {
        if (!Array.isArray(n.arrival.segments) || n.arrival.segments.length > 200 || !dense(n.arrival.segments)) error(`${at}.arrival`, 'Provide up to 200 rate periods.');
        else {
          let last = 0;
          n.arrival.segments.forEach((s, j) => {
            if (!object(s) || !finite(s.start) || !finite(s.end) || s.start < last || s.end <= s.start || !finite(m.horizon) || s.end > m.horizon || !finite(s.perHour) || s.perHour < 0 || s.perHour > MAX_ARRIVALS_PER_HOUR) error(`${at}.arrival.segments.${j}`, 'Arrival periods must be ordered, non-overlapping, within the run and have valid rates.');
            if (object(s) && finite(s.end)) last = s.end;
          });
        }
      } else error(`${at}.arrival`, 'Unknown arrival pattern.');
      if (!Array.isArray(n.classes) || n.classes.length === 0 || n.classes.length > 20 || !dense(n.classes)) error(`${at}.classes`, 'Provide 1–20 visitor or job classes.');
      else {
        const seen = new Set<string>(); let sum = 0;
        n.classes.forEach((c, j) => {
          if (!object(c) || !id(c.id) || seen.has(String(c.id)) || !text(c.label) || !finite(c.priority) || !Number.isInteger(c.priority) || Math.abs(c.priority) > 1000 || !finite(c.probability) || c.probability < 0 || c.probability > 1) error(`${at}.classes.${j}`, 'Classes need unique IDs, a name, integer priority and valid probability.');
          if (object(c)) { seen.add(String(c.id)); if (finite(c.probability)) sum += c.probability; }
        });
        if (Math.abs(sum - 1) > 1e-9) error(`${at}.classes`, 'Class probabilities must add up to 1.');
      }
    } else if (n.kind === 'queue') {
      if (n.capacity !== null && (!finite(n.capacity) || !Number.isInteger(n.capacity) || n.capacity < 0 || n.capacity > MAX_WAITING_PLACES)) error(`${at}.capacity`, 'Waiting capacity must be an integer from 0 to 10,000,000, or unlimited.');
      if (!['fifo', 'priority'].includes(String(n.discipline))) error(`${at}.discipline`, 'Choose FIFO or priority.');
      if (n.patience !== null) distribution(n.patience, `${at}.patience`, true);
    } else if (n.kind === 'service') {
      distribution(n.duration, `${at}.duration`, false);
      if (!finite(n.servers) || !Number.isInteger(n.servers) || n.servers < 1 || n.servers > 1000) error(`${at}.servers`, 'Parallel servers must be an integer from 1 to 1,000.');
      if (!Array.isArray(n.resources) || n.resources.length > 10 || !dense(n.resources)) error(`${at}.resources`, 'Provide at most 10 resource requirements.');
      else {
        const seen = new Set<string>();
        n.resources.forEach((req, j) => {
          if (!object(req) || !poolIds.has(String(req.poolId)) || seen.has(String(req.poolId)) || !finite(req.units) || !Number.isInteger(req.units) || req.units < 1 || req.units > (installed.get(String(req.poolId)) ?? 0)) error(`${at}.resources.${j}`, 'Require each known resource once, with units within installed capacity.');
          if (object(req)) seen.add(String(req.poolId));
        });
      }
    } else if (n.kind === 'delay') distribution(n.duration, `${at}.duration`, true);
    else if (n.kind === 'route') {
      if (!Array.isArray(n.branches) || n.branches.length === 0 || n.branches.length > 100 || !dense(n.branches)) error(`${at}.branches`, 'Provide 1–100 destinations.');
      else {
        let sum = 0;
        n.branches.forEach((b, j) => {
          if (!object(b) || !id(b.to) || !finite(b.probability) || b.probability < 0 || b.probability > 1) error(`${at}.branches.${j}`, 'Every route needs a destination and valid probability.');
          if (object(b) && finite(b.probability)) sum += b.probability;
        });
        if (Math.abs(sum - 1) > 1e-9) error(`${at}.branches`, 'Route probabilities must add up to 1.');
      }
    } else if (n.kind !== 'sink') error(`${at}.kind`, 'Unknown process step.');
  }
  let sources = 0; let sinks = 0;
  const edges = new Map<string, string[]>();
  for (const [key, n] of nodes) {
    if (n.kind === 'source') sources++;
    if (n.kind === 'sink') sinks++;
    const destinations = n.kind === 'route' && Array.isArray(n.branches) ? n.branches.filter(object).map(b => String(b.to)) : n.kind === 'sink' ? [] : [String(n.next)];
    edges.set(key, destinations);
    for (const dest of destinations) if (!nodes.has(dest)) error(`nodes.${key}.next`, `Connect ${String(n.label)} to an existing step.`);
    if (n.kind === 'queue' && nodes.get(String(n.next))?.kind !== 'service') error(`nodes.${key}.next`, 'A waiting queue must feed exactly one service station.');
    if (destinations.some(d => nodes.get(d)?.kind === 'source')) error(`nodes.${key}.next`, 'An arrival source cannot receive incoming work.');
  }
  if (!sources || !sinks) error('nodes', 'Include at least one arrival source and one exit.');
  const serviceQueues = new Map<string, number>();
  for (const n of nodes.values()) if (n.kind === 'queue') serviceQueues.set(String(n.next), (serviceQueues.get(String(n.next)) ?? 0) + 1);
  for (const [key, count] of serviceQueues) if (count > 1) error(`nodes.${key}`, 'Use one waiting queue per service station; merge flows before that queue.');
  const canBeZero = (n: Record<string, unknown>) => {
    if (n.kind === 'service' || n.kind === 'sink') return false;
    if (n.kind !== 'delay') return true;
    if (!object(n.duration)) return false;
    return n.duration.kind === 'constant' ? n.duration.value === 0 : n.duration.kind === 'triangular' ? n.duration.min === 0 : n.duration.kind === 'empirical' ? Array.isArray(n.duration.values) && n.duration.values.includes(0) : false;
  };
  const visiting = new Set<string>(); const visited = new Set<string>();
  function cycle(key: string): boolean {
    if (visiting.has(key)) return true;
    if (visited.has(key) || !nodes.has(key) || !canBeZero(nodes.get(key)!)) return false;
    visiting.add(key);
    for (const next of edges.get(key) ?? []) if (cycle(next)) return true;
    visiting.delete(key); visited.add(key); return false;
  }
  for (const key of nodes.keys()) if (cycle(key)) { error('nodes', 'Remove the possible zero-time loop, or add a strictly positive processing delay.'); break; }
  return issues;
}

export function validateProject(value: unknown): ValidationIssue[] {
  if (!object(value)) return [{ path: 'project', message: 'Project must be an object.', severity: 'error' }];
  const issues = validateModel(value.model);
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' });
  if (value.schemaVersion !== 1) error('schemaVersion', 'This project version is not supported. Your current project has not been replaced.');
  if (!id(value.id) || !text(value.name) || !['factory', 'festival', 'service'].includes(String(value.world))) error('project', 'Project identity, name or world is invalid.');
  if (!finite(value.revision) || !Number.isSafeInteger(value.revision) || value.revision < 0) error('revision', 'Invalid project revision.');
  if (typeof value.description !== 'string' || value.description.length > 5000) error('description', 'Description is too long or missing.');
  if (!object(value.layout) || Object.entries(value.layout).length > 100) error('layout', 'Layout must contain at most 100 positions.');
  else for (const [key, p] of Object.entries(value.layout)) if (!id(key) || !object(p) || !finite(p.x) || !finite(p.z) || Math.abs(p.x) > 100 || Math.abs(p.z) > 100) error(`layout.${key}`, 'Use valid positions within the workspace.');
  issues.push(...validateFacility(value.facility, facilityNodeIds(value.model)));
  if (value.scenarios !== undefined) {
    if (!Array.isArray(value.scenarios) || value.scenarios.length > 20 || !dense(value.scenarios)) error('scenarios', 'A project can keep at most 20 saved scenarios.');
    else {
      const seen = new Set<string>();
      value.scenarios.forEach((scenario, i) => {
        const at = `scenarios.${i}`;
        if (!object(scenario)) { error(at, 'Scenario must be an object.'); return; }
        if (!id(scenario.id) || seen.has(String(scenario.id)) || !text(scenario.name) || typeof scenario.createdAt !== 'string' || !Number.isFinite(Date.parse(scenario.createdAt)) || !['factory', 'festival', 'service'].includes(String(scenario.world))) error(at, 'Scenario identity, name, date or world is invalid.');
        seen.add(String(scenario.id));
        issues.push(...validateModel(scenario.model).map(issue => ({ ...issue, path: `${at}.${issue.path}` })));
        if (!object(scenario.layout) || Object.keys(scenario.layout).length > 100) error(`${at}.layout`, 'Scenario positions are invalid.');
        else for (const [key, p] of Object.entries(scenario.layout)) if (!id(key) || !object(p) || !finite(p.x) || !finite(p.z) || Math.abs(p.x) > 100 || Math.abs(p.z) > 100) error(`${at}.layout.${key}`, 'Scenario position must be finite and within the workspace.');
        issues.push(...validateFacility(scenario.facility, facilityNodeIds(scenario.model), `${at}.facility`));
      });
    }
  }
  return issues;
}

export function parseProject(text: string): Project {
  if (new TextEncoder().encode(text).length > 5_000_000) throw new Error('Project files are limited to 5 MB.');
  const value: unknown = JSON.parse(text);
  const issues = validateProject(value).filter(i => i.severity === 'error');
  if (issues.length) throw new Error(issues.slice(0, 3).map(i => i.message).join(' '));
  return value as Project;
}

export function assertModel(value: unknown): asserts value is SimulationModel {
  const issues = validateModel(value).filter(i => i.severity === 'error');
  if (issues.length) throw new Error(issues.map(i => `${i.path}: ${i.message}`).join('\n'));
}
