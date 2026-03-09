#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';

import { CommandBuilder, ProcessState } from './commands.ts';

const READ_OPTIONS = { encoding: 'utf8' } as const;
const EXAMPLE_ENV_PATH = 'examples/.env.example';
const oxfmt = new CommandBuilder({ main: 'oxfmt', sub: [] });

type EnvMode = 'dev' | 'prod';
type PlaceholderMap = Record<string, string>;

const ENV_PRESETS: Record<EnvMode, PlaceholderMap> = {
  dev: {
    APP_ENV: 'dev',
    RELAY_HOST: '127.0.0.1',
    RELAY_PORT: '8787',
    RELAY_PATH: '/',
    RELAY_URL: 'ws://127.0.0.1:8787/',
    REMOTE_COPILOT_CLIENT_ID: 'default'
  },
  prod: {
    APP_ENV: 'prod',
    RELAY_HOST: '0.0.0.0',
    RELAY_PORT: '8787',
    RELAY_PATH: '/',
    RELAY_URL: 'wss://relay.example.com/',
    REMOTE_COPILOT_CLIENT_ID: 'production'
  }
};

const resolveTargetPath = (mode: EnvMode) => {
  return path.resolve(process.cwd(), `.env.${mode}`);
};

const renderEnvFile = (template: string, values: PlaceholderMap) => {
  return `${template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    return values[key] ?? match;
  })}\n`;
};

const writeEnvFile = async (mode: EnvMode, template: string) => {
  const targetPath = resolveTargetPath(mode);
  const content = renderEnvFile(template.trimEnd(), ENV_PRESETS[mode]);

  await writeFile(targetPath, content, READ_OPTIONS);
  console.log(`📝 Generated ${pc.cyan(path.basename(targetPath))}`);
};

const generateEnvFiles = async (modes: EnvMode[]) => {
  const template = await readFile(EXAMPLE_ENV_PATH, READ_OPTIONS);

  for (const mode of modes) {
    await writeEnvFile(mode, template);
  }
};

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
