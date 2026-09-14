// Absolute paths to the repo root and the pages under test.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const YATZY_PATH = join(REPO_ROOT, 'yatzy.html');
export const PALAUTE_PATH = join(REPO_ROOT, 'palaute.html');
