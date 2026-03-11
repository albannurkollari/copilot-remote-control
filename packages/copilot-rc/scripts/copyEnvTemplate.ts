import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = fileURLToPath(new URL('.', import.meta.url));
const PACKAGE_ROOT = path.resolve(CURRENT_DIR, '..');
const SOURCE_PATH = path.resolve(PACKAGE_ROOT, '../../examples/.env.example');
const TARGET_PATH = path.resolve(PACKAGE_ROOT, 'dist/.env.example');

await mkdir(path.dirname(TARGET_PATH), { recursive: true });
await copyFile(SOURCE_PATH, TARGET_PATH);
