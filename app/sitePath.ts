const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function sitePath(path: string) {
  const normalizedPath = path === '/' ? '/' : `${path.replace(/\/$/, '')}/`;
  return `${basePath}${normalizedPath}`;
}
