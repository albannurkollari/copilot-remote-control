#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { CommandBuilder, ProcessState } from './commands.ts';

const APPS_DIR = 'packages';
const PACKAGE_JSON = 'package.json';
const TS_CONFIG_PATHS_JSON = 'tsconfig.paths.json';
const READ_OPTIONS = { encoding: 'utf8' } as const;
const oxfmt = new CommandBuilder({ main: 'oxfmt', sub: [] });

type ImportsMap = Record<string, string | Record<string, string>>;
type WhichPackage = 'root' | `${typeof APPS_DIR}/${string}`;

type PackageJsonRecord = {
  imports?: ImportsMap;
  path: string;
  raw: string;
} & Record<string, unknown>;

const toPackageJSONString = (pkg: Record<string, unknown>) => {
  return `${JSON.stringify(pkg, null, 2)}\n`;
};

const getPathKey = (name: string) => {
  if (/^discord/i.test(name)) {
    return 'discord';
  }

  if (/^vscode/i.test(name)) {
    return 'extension';
  }

  if (/^relay/i.test(name)) {
    return 'relay';
  }

  return name;
};

const getPackageJson = async (
  which: WhichPackage = 'root',
  failOnError = true
) => {
  try {
    const pkgPath =
      which === 'root' ? PACKAGE_JSON : path.join(which, PACKAGE_JSON);
    const pkgRaw = await readFile(pkgPath, READ_OPTIONS);

    return {
      ...JSON.parse(pkgRaw),
      path: pkgPath,
      raw: pkgRaw
    } as PackageJsonRecord;
  } catch {
    console.log(pc.yellow(`⚠ Skipping "${which}/${PACKAGE_JSON}" or`));
    console.log(pc.redBright(`❌ No "${which}/${PACKAGE_JSON}" found`));

    if (failOnError) {
      process.exit(1);
    }

    return { path: '', raw: '' } as PackageJsonRecord;
  }
};

const getPackageDirs = async () => {
  try {
    const dirs = await readdir(APPS_DIR, {
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

const toPackageRelativeTarget = (packageDir: string, target: string) => {
  if (!target.startsWith(`./${APPS_DIR}/`)) {
    return target;
  }

  const absoluteTarget = path.resolve(process.cwd(), target);
  const relativeTarget = path
    .relative(packageDir, absoluteTarget)
    .replace(/\\/g, '/');

  return relativeTarget.startsWith('.')
    ? relativeTarget
    : `./${relativeTarget}`;
};

const toPackageRelativeImports = (
  packageJsonPath: string,
  imports: ImportsMap
): ImportsMap => {
  const packageDir = path.dirname(packageJsonPath);

  return Object.fromEntries(
    Object.entries(imports).map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, toPackageRelativeTarget(packageDir, value)];
      }

      if (typeof value === 'object' && value !== null) {
        return [
          key,
          Object.fromEntries(
            Object.entries(value).map(([subKey, subValue]) => [
              subKey,
              toPackageRelativeTarget(packageDir, subValue)
            ])
          )
        ];
      }

      return [key, value];
    })
  ) as ImportsMap;
};

async function mirrorImportsToPathsInTSConfig() {
  const { imports = {} } = await getPackageJson('root');
  const paths: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(imports)) {
    if (!key.startsWith('#')) {
      continue;
    }

    const tsPath =
      typeof value === 'string'
        ? value
        : typeof value === 'object' && value !== null
          ? value.default
          : null;

    if (!tsPath) {
      continue;
    }

    paths[key] = [tsPath.replace(/^\.\//, '')];
  }

  const config = { compilerOptions: { paths } };
  await writeFile(TS_CONFIG_PATHS_JSON, toPackageJSONString(config));
  console.log(`📝 Updated config file: ${pc.cyan(TS_CONFIG_PATHS_JSON)}`);
}

async function generateImportsFromPackages() {
  const dirs = await getPackageDirs();
  const { raw, path: pkgPath, ...pkg } = await getPackageJson('root');
  const imports: ImportsMap = {};

  for (const dir of dirs) {
    imports[`#${getPathKey(dir.name)}/*`] = `./${APPS_DIR}/${dir.name}/src/*`;
  }

  pkg.imports = { ...pkg.imports, ...imports };

  const next = toPackageJSONString(pkg);
  if (next !== raw) {
    await writeFile(pkgPath, next);
    console.log(`ℹ️  ${pc.cyan('Generated root import aliases')}`);
    return;
  }

  console.log(`ℹ️  ${pc.yellow('No changes to root imports, skipping...')}`);
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
        continue;
      }

      console.log(
        `📦 No changes to exports → ${pc.yellow(pkgPath)}, skipping...`
      );
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
      pkg.imports = {
        ...pkg.imports,
        ...toPackageRelativeImports(pkgPath, imports)
      };

      const next = toPackageJSONString(pkg);
      if (next !== raw) {
        await writeFile(pkgPath, next);
        console.log(`🔁 Synced imports → ${pc.cyan(pkgPath)}`);
        continue;
      }

      console.log(`🔁 Imports already synced → ${pc.yellow(pkgPath)}`);
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
    const toFormat = [
      PACKAGE_JSON,
      TS_CONFIG_PATHS_JSON,
      `${APPS_DIR}/*/${PACKAGE_JSON}`
    ];
    oxfmt.run(toFormat, { debugCommand: false });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
