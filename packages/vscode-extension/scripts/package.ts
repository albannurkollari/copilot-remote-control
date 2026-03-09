import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const vscePackageJson = require.resolve('@vscode/vsce/package.json');
const minimatchId = require.resolve('minimatch', {
  paths: [path.dirname(vscePackageJson)]
});
const minimatchModule = require(minimatchId);

if (
  typeof minimatchModule !== 'function' &&
  typeof minimatchModule.minimatch === 'function'
) {
  const cacheEntry = require.cache[minimatchId];

  if (cacheEntry) {
    cacheEntry.exports = minimatchModule.minimatch;
  }
}

const { createVSIX } = require('@vscode/vsce');

async function main() {
  const cwd = path.resolve(__dirname, '..');

  await createVSIX({
    cwd,
    dependencies: false,
    skipLicense: true
  });
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
