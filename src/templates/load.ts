import { assetURL } from '../assetUrl';
import { duplicateProject } from '../model/commands';
import { openProjectJSON } from '../storage/projectFile';
import { findStarter, type StarterId } from './catalogue';
import inventory from './inventory.json';
import { starterMessages as m } from '../ui/messages/starterTemplates';

/** Fetch only the selected, versioned project. Bound decoded bytes before parsing. */
export async function loadStarter(id: StarterId, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const item = findStarter(id), expected = inventory[id];
  if (!item || !expected) throw new Error(m.invalid);
  try {
    const response = await fetcher(assetURL(`/templates/${id}.json?v=${expected.sha256.slice(0, 16)}`), { cache: 'no-cache', signal });
    if (!response.ok || !response.body) throw new Error(m.failed);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.byteLength;
        if (length > expected.bytes) { await reader.cancel(); throw new Error(m.invalid); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    if (length !== expected.bytes) throw new Error(m.invalid);
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== expected.sha256) throw new Error(m.invalid);
    const source = openProjectJSON(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (source.id !== `starter-${id}` || source.world !== item.world || source.model.nodes.length !== expected.steps || source.facility?.objects.length !== expected.objects || source.scenarios?.length !== 3) throw new Error(m.invalid);
    const project = duplicateProject(source); project.name = source.name; return project;
  } catch (error) { throw new Error(error instanceof Error && error.message === m.invalid ? m.invalid : m.failed); }
}
