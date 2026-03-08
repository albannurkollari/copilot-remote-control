#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { CommandBuilder, ProcessState } from './commands.ts';

const APPS_DIR = 'packages';
const pkgJson = 'package.json';
const tsConfigPathsJson = 'tsconfig.paths.json';
const fileReadOptions = { encoding: 'utf8' } as const;
const oxfmt = new CommandBuilder({ main: 'oxfmt', sub: [] });

type ImportsMap = Record<string, string | Record<string, string>>;
type WhichPackage = 'root' | `${typeof APPS_DIR}/${string}`;

const getPackageJson = async (
  which: WhichPackage = 'root',
  failOnError = true
) => {
  type PathAndPackageRecord = {
    imports?: ImportsMap;
    path: string;
    raw: string;
  } & Record<string, unknown>;

  try {
    const pkgPath = (() => {
      if (which === 'root') {
        return path.relative(process.cwd(), pkgJson);
      } else if (which.startsWith(`${APPS_DIR}/`)) {
        const filePath = path.join(which, pkgJson);

        return path.relative(process.cwd(), filePath);
      }

      // Error log handled in catch block, just throw to skip to it.
      throw '';
    })();

    const pkgRaw = await readFile(pkgPath, fileReadOptions);

    return {
      ...JSON.parse(pkgRaw),
      path: pkgPath,
      raw: pkgRaw
    } as PathAndPackageRecord;
  } catch {
    console.log(pc.yellow(`⚠ Skipping "${which}/${pkgJson}" or`));
    console.log(pc.redBright(`❌ No "${which}/${pkgJson}" found`));

    if (failOnError) {
      process.exit(1);
    }

    return { path: '' } as PathAndPackageRecord;
  }
};

const getPackageDirs = async () => {
  const packagesDir = path.relative(process.cwd(), APPS_DIR);
  try {
    const dirs = await readdir(packagesDir, {
      encoding: 'utf8',
      withFileTypes: true
    });

    return dirs.filter((dir) => dir.isDirectory());
  } catch (error) {
    console.error(
      `Something went wrong reading the "${APPS_DIR}" directory:`,
      error
    );
    process.exit(1);
  }
};

const toPackageJSONString = (pkg: Record<string, unknown>) => {
  return `${JSON.stringify(pkg, null, 2)}\n`;
};

const getPathKey = (name: string) => {
  if (/^discord/i.test(name)) {
    return 'discord';
  } else if (/^vscode/i.test(name)) {
    return 'extension';
  } else if (/^relay/i.test(name)) {
    return 'relay';
  }

  return name;
};

async function mirrorImportsToPathsInTSConfig() {
  const { imports = {} } = await getPackageJson('root');
  const paths: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(imports)) {
    if (!key.startsWith('#')) continue;

    const tsPath =
      typeof value === 'string'
        ? value
        : typeof value === 'object'
          ? value.default
          : null;

    if (!tsPath) continue;

    paths[key] = [tsPath.replace(/^\.\//, '')];
  }

  const outputPath = path.relative(process.cwd(), tsConfigPathsJson);
  const config = { compilerOptions: { paths } };
  await writeFile(outputPath, toPackageJSONString(config));
  console.log(`📝 Updated config file: ${pc.cyan(outputPath)}`);
}

async function generateImportsFromPackages() {
  const dirs = await getPackageDirs();
  const { raw, path: pkgPath, ...pkg } = await getPackageJson('root');
  const imports: ImportsMap = {};

  for (const dir of dirs) {
    const name = dir.name;
    const key = getPathKey(name);

    imports[`#${key}/*`] = `./${APPS_DIR}/${name}/src/*`;
  }

  pkg.imports = { ...pkg.imports, ...imports };

  const next = toPackageJSONString(pkg);

  if (next !== raw) {
    await writeFile(pkgPath, next);
    console.log(`ℹ️  ${pc.cyan('Generated root import aliases')}`);
  } else {
    console.log(`ℹ️  ${pc.yellow('No changes to root imports, skipping...')}`);
  }
}

async function generateExportsForPackages() {
  const dirs = await getPackageDirs();
  const rootPkg = await getPackageJson('root');
  const appName = rootPkg.name ?? 'root';

  for (const dir of dirs) {
    const pkgDir: WhichPackage = `${APPS_DIR}/${dir.name}`;
    const { path: pkgPath, raw, ...pkg } = await getPackageJson(pkgDir);

    try {
      pkg.name ??= `@${appName}/${dir.name}`;
      pkg.exports = {
        '.': {
          types: './dist/index.d.ts',
          default: './dist/index.js'
        }
      };

      const next = toPackageJSONString(pkg);

      if (next !== raw) {
        await writeFile(pkgPath, next);
        console.log(`📦 Generated exports → ${pc.cyan(pkgPath)}`);
      } else {
        console.log(
          `📦 No changes to exports → ${pc.yellow(pkgPath)}, skipping...`
        );
      }
    } catch {
      console.log(pc.redBright(`⚠ Failed to write to ${pkgPath}. Skipping...`));
    }
  }
}

async function mirrorImportsToPackages() {
  const dirs = await getPackageDirs();
  const rootPkg = await getPackageJson('root');
  const imports: ImportsMap = rootPkg.imports ?? {};

  for (const dir of dirs) {
    const pkgDir: WhichPackage = `${APPS_DIR}/${dir.name}`;
    const { path: pkgPath, raw, ...pkg } = await getPackageJson(pkgDir);

    try {
      pkg.imports = { ...pkg.imports, ...imports };

      const next = toPackageJSONString(pkg);

      if (next !== raw) {
        await writeFile(pkgPath, next);
        console.log(`🔁 Synced imports → ${pc.cyan(pkgPath)}`);
      } else {
        console.log(`🔁 Imports already synced → ${pc.yellow(pkgPath)}`);
      }
    } catch {
      console.log(pc.redBright(`⚠ Failed to write ${pkgPath}, skipping...`));
    }
  }
}

async function syncAliases() {
  await generateImportsFromPackages();
  await mirrorImportsToPathsInTSConfig();
  await mirrorImportsToPackages();
  await generateExportsForPackages();
}

const result = (() => {
  const state = new ProcessState(
    '--generateExportsForPackages',
    '--generateImportsFromPackages',
    '--mirrorImportsToPackages',
    '--mirrorImportsToPaths',
    '--syncAliases'
  );

  if (state.flags.syncAliases) {
    return syncAliases();
  }

  if (state.flags.generateImportsFromPackages) {
    return generateImportsFromPackages();
  }

  if (state.flags.generateExportsForPackages) {
    return generateExportsForPackages();
  }

  if (state.flags.mirrorImportsToPaths) {
    return mirrorImportsToPathsInTSConfig();
  }

  if (state.flags.mirrorImportsToPackages) {
    return mirrorImportsToPackages();
  }

  return Promise.resolve();
})();

result
  .then(() => {
    const toFormat = [pkgJson, tsConfigPathsJson, `${APPS_DIR}/*/${pkgJson}`];

    oxfmt.run(toFormat, { debugCommand: false });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
