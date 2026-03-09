#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, '..');

const packageJsonPaths = [
  'package.json',
  'packages/copilot-rc/package.json',
  'packages/discord-bot/package.json',
  'packages/relay-server/package.json',
  'packages/shared/package.json',
  'packages/vscode-extension/package.json'
].map((relativePath) => path.resolve(REPO_ROOT, relativePath));

const nextVersion = process.argv[2]?.trim();

if (!nextVersion) {
  throw new Error('Expected release version as the first argument.');
}

const updatePackageVersion = async (packageJsonPath: string) => {
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const manifest = JSON.parse(packageJson) as { version?: string };

  if (manifest.version === nextVersion) {
    return;
  }

  manifest.version = nextVersion;
  await writeFile(
    packageJsonPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
};

await Promise.all(packageJsonPaths.map(updatePackageVersion));
