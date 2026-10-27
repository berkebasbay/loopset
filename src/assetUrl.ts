/** Resolve a bundled public file at either a site root or a deployment subpath. */
export function assetURL(path: string, base = import.meta.env.BASE_URL): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return `${base}${path.slice(1)}`;
}
