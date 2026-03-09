import type { IPackageOptions, IPublishVSIXOptions } from '@vscode/vsce';

import { createVSIX, publishVSIX } from '@vscode/vsce';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProcessState } from '../../../scripts/commands.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(packageRoot, 'package.json');
const state = new ProcessState('--package', '--publish');
const positionalArgs = process.argv.slice(2).filter((arg) => {
  return !arg.startsWith('--');
});

const assertRequired = (value: string | undefined, name: string) => {
  if (!value || value.length === 0) {
    throw new Error(`Missing required ${name}.`);
  }

  return value;
};

const updateManifestVersion = async (version: string) => {
  const originalPackageJson = await readFile(packageJsonPath, 'utf8');
  const manifest = JSON.parse(originalPackageJson) as { version: string };

  if (manifest.version !== version) {
    manifest.version = version;
    await writeFile(
      packageJsonPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );
  }

  return originalPackageJson;
};

const readManifestVersion = async () => {
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const manifest = JSON.parse(packageJson) as { version: string };
  return manifest.version;
};

const createVsixPath = (version: string) => {
  return path.join(packageRoot, 'dist', `remote-copilot-host-${version}.vsix`);
};

const packageExtension = async (packagePath?: string) => {
  const options: IPackageOptions = {
    cwd: packageRoot,
    dependencies: false,
    packagePath,
    skipLicense: true
  };

  await createVSIX(options);
};

const publishExtension = async (packagePath: string, pat: string) => {
  const options: IPublishVSIXOptions = {
    cwd: packageRoot,
    pat,
    skipDuplicate: true
  };

  await publishVSIX(packagePath, options);
};

const withReleaseVersion = async <T>(
  version: string,
  action: () => Promise<T>
) => {
  const originalPackageJson = await updateManifestVersion(version);

  try {
    return await action();
  } finally {
    await writeFile(packageJsonPath, originalPackageJson, 'utf8');
  }
};

const runCli = async () => {
  if (state.flags.publish) {
    const version = assertRequired(
      process.env.RELEASE_VERSION?.trim() || positionalArgs[0],
      'RELEASE_VERSION'
    );
    const pat = assertRequired(process.env.VSCE_PAT?.trim(), 'VSCE_PAT');

    await withReleaseVersion(version, async () => {
      const packagePath = createVsixPath(version);

      await packageExtension(packagePath);
      await publishExtension(packagePath, pat);
    });

    return;
  }

  if (state.flags.package) {
    await packageExtension(createVsixPath(await readManifestVersion()));
    return;
  }

  throw new Error('Missing action flag. Use --package or --publish.');
};

void runCli().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
