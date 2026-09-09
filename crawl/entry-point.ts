import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function isEntryPoint(moduleUrl: string, entry: string | undefined): boolean {
  if (entry === undefined) return false;
  return moduleUrl === pathToFileURL(realpathSync(entry)).href;
}
