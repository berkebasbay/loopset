import { afterEach, expect, it, vi } from 'vitest';
import { simulate } from '../src/engine';
import { createExample } from '../src/examples';
import { resultCardPNG } from '../src/storage/resultCard';

const context = () => ({ measureText: (text: string) => ({ width: text.length * 4 }), fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} });
const run = () => simulate(createExample('service').model);
const png = () => new Blob(['synthetic encoding fixture'], { type: 'image/png' });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function documentFixture() {
  const canvas = { width: 0, height: 0, getContext: () => context(), toBlob: (callback: (value: Blob) => void) => callback(png()) };
  vi.stubGlobal('document', { fonts: { load: () => Promise.resolve([]) }, createElement: () => canvas });
  return canvas;
}
it('uses supported offscreen encoding and keeps the captured run identity', async () => {
  documentFixture(); const encode = vi.fn(async () => png());
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return context(); } convertToBlob() { return encode(); } });
  const result = run(), encoded = await resultCardPNG(result);
  expect(encode).toHaveBeenCalledOnce(); expect(encoded.filename).toContain(result.id); expect(encoded.blob.type).toBe('image/png');
});
it('keeps the HTML path when offscreen 2D rendering is unavailable', async () => {
  documentFixture();
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } convertToBlob() { throw new Error('unavailable'); } });
  const encoded = await resultCardPNG(run()); expect(encoded.blob.size).toBeGreaterThan(0); expect(encoded.blob.type).toBe('image/png');
});
it('retains the five-second deadline for a stalled encoder', async () => {
  vi.useFakeTimers(); documentFixture();
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return context(); } convertToBlob() { return new Promise(() => {}); } });
  const pending = expect(resultCardPNG(run())).rejects.toThrow('PNG encoding timed out');
  await vi.advanceTimersByTimeAsync(5000); await pending;
});
