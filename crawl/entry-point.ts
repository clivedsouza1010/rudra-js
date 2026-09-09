import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function isEntryPoint(moduleUrl: string, entry: string | undefined): boolean {
  if (entry === undefined) return false;

  let resolved: string;
  try {
    resolved = realpathSync(entry);
  } catch {
    return false;
  }

  return moduleUrl === pathToFileURL(resolved).href;
}
