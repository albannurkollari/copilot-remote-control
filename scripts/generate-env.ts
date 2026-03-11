#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pc from 'picocolors';

import {
  type EnvMode,
  ENV_PRESETS,
  mergeRemoteCopilotEnvValues,
  renderEnvFile,
  resolveEnvPath
} from '../packages/shared/src/env.ts';
import { CommandBuilder, ProcessState } from './commands.ts';

const READ_OPTIONS = { encoding: 'utf8' } as const;
const CURRENT_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, '../..');
const EXAMPLE_ENV_PATH = path.resolve(REPO_ROOT, 'examples/.env.example');
const oxfmt = new CommandBuilder({ main: 'oxfmt', sub: [] });

const writeEnvFile = async (mode: EnvMode, template: string) => {
  const targetPath = resolveEnvPath(mode, REPO_ROOT);
  const content = renderEnvFile(
    template.trimEnd(),
    mergeRemoteCopilotEnvValues(mode, ENV_PRESETS[mode])
  );

  await writeFile(targetPath, content, READ_OPTIONS);
  console.log(`📝 Generated ${pc.cyan(path.basename(targetPath))}`);
};

const generateEnvFiles = async (modes: EnvMode[]) => {
  const template = await readFile(EXAMPLE_ENV_PATH, READ_OPTIONS);

  for (const mode of modes) {
    await writeEnvFile(mode, template);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = (() => {
    const state = new ProcessState('--all', '--dev', '--prod');
    const modes: EnvMode[] = [];

    if (state.flags.all || (!state.flags.dev && !state.flags.prod)) {
      modes.push('dev', 'prod');
    } else {
      if (state.flags.dev) {
        modes.push('dev');
      }

      if (state.flags.prod) {
        modes.push('prod');
      }
    }

    return generateEnvFiles(modes);
  })();

  result
    .then(() => {
      oxfmt.run(['README.md', 'package.json', 'scripts/*.ts'], {
        debugCommand: false,
        log: false
      });
    })
    .catch((error) => {
      console.error(pc.redBright(String(error)));
      process.exit(1);
    });
}
