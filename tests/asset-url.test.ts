import { afterEach, expect, it, vi } from 'vitest';
import { assetURL } from '../src/assetUrl';

afterEach(() => vi.unstubAllEnvs());

it('resolves the same public file at the local root and the Pages subpath', () => {
  vi.stubEnv('BASE_URL', '/');
  expect(assetURL('/previews/factory.png')).toBe('/previews/factory.png');
  vi.stubEnv('BASE_URL', '/loopset/');
  expect(assetURL('/previews/factory.png')).toBe('/loopset/previews/factory.png');
  expect(assetURL('/assets/simready/desk_a01.png')).toBe('/loopset/assets/simready/desk_a01.png');
  expect(assetURL('data:image/png;base64,AA')).toBe('data:image/png;base64,AA');
});
