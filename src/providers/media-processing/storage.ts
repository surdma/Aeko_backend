import { join } from 'node:path';

/**
 * One configured root for every processed artefact. Names are generated, never
 * derived from the uploaded filename, so a caller cannot influence the path.
 */
export const STORAGE_ROOT = join(process.cwd(), 'uploads');

export const publicUrl = (name: string): string =>
  `/uploads/${encodeURIComponent(name)}`;
