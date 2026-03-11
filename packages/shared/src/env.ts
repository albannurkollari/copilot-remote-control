import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';

const READ_OPTIONS = { encoding: 'utf8' } as const;
const PLACEHOLDER_PREFIXES = ['replace-with-', '{{'];

export type EnvMode = 'dev' | 'prod';
export type EnvValues = Record<string, string>;
export type PlaceholderMap = Record<string, string>;

export const REMOTE_COPILOT_REQUIRED_KEYS = [
  'DISCORD_APPLICATION_ID',
  'DISCORD_GUILD_ID',
  'DISCORD_TOKEN',
  'REMOTE_COPILOT_SHARED_SECRET'
] as const;

export const ENV_PRESETS: Record<EnvMode, EnvValues> = {
  dev: {
    APP_ENV: 'dev',
    DISCORD_APPLICATION_ID: '',
    DISCORD_GUILD_ID: '',
    DISCORD_STREAM_UPDATE_MS: '1200',
    DISCORD_TOKEN: '',
    RELAY_HOST: '127.0.0.1',
    RELAY_LOG: 'standard',
    RELAY_PORT: '8787',
    RELAY_PATH: '/',
    RELAY_URL: 'ws://127.0.0.1:8787/',
    REMOTE_COPILOT_CLIENT_ID: 'default',
    REMOTE_COPILOT_SHARED_SECRET: '',
    VSCODE_REMOTE_COPILOT_CLIENT_ID: 'default',
    VSCODE_REMOTE_COPILOT_RELAY_URL: 'ws://127.0.0.1:8787/',
    VSCODE_REMOTE_COPILOT_SHARED_SECRET: ''
  },
  prod: {
    APP_ENV: 'prod',
    DISCORD_APPLICATION_ID: '',
    DISCORD_GUILD_ID: '',
    DISCORD_STREAM_UPDATE_MS: '1200',
    DISCORD_TOKEN: '',
    RELAY_HOST: '0.0.0.0',
    RELAY_LOG: 'standard',
    RELAY_PORT: '8787',
    RELAY_PATH: '/',
    RELAY_URL: 'wss://relay.example.com/',
    REMOTE_COPILOT_CLIENT_ID: 'production',
    REMOTE_COPILOT_SHARED_SECRET: '',
    VSCODE_REMOTE_COPILOT_CLIENT_ID: 'production',
    VSCODE_REMOTE_COPILOT_RELAY_URL: 'wss://relay.example.com/',
    VSCODE_REMOTE_COPILOT_SHARED_SECRET: ''
  }
};

export const resolveEnvPath = (mode: EnvMode, rootDir = process.cwd()) => {
  return path.resolve(rootDir, `.env.${mode}`);
};

export const renderEnvFile = (template: string, values: PlaceholderMap) => {
  return `${template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    return values[key] ?? match;
  })}\n`;
};

export const isMeaningfulValue = (value: string | undefined) => {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }

  return !PLACEHOLDER_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
};

export const normalizeRelayPath = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === '/') {
    return '/';
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

export const buildRelayUrl = (values: EnvValues) => {
  if (isMeaningfulValue(values.RELAY_URL)) {
    return values.RELAY_URL;
  }

  const host = values.RELAY_HOST || '127.0.0.1';
  const port = values.RELAY_PORT || '8787';
  const relayPath = normalizeRelayPath(values.RELAY_PATH || '/');
  const protocol = values.APP_ENV === 'prod' ? 'wss' : 'ws';

  return `${protocol}://${host}:${port}${relayPath}`;
};

export const mergeRemoteCopilotEnvValues = (
  mode: EnvMode,
  values: Partial<EnvValues> = {}
) => {
  const normalizedValues = Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    })
  );

  const merged: EnvValues = {
    ...ENV_PRESETS[mode],
    ...normalizedValues
  };

  merged.APP_ENV = mode;
  merged.RELAY_PATH = normalizeRelayPath(merged.RELAY_PATH);
  merged.RELAY_LOG = merged.RELAY_LOG || 'standard';
  merged.DISCORD_STREAM_UPDATE_MS = merged.DISCORD_STREAM_UPDATE_MS || '1200';
  merged.REMOTE_COPILOT_CLIENT_ID =
    merged.REMOTE_COPILOT_CLIENT_ID ||
    ENV_PRESETS[mode].REMOTE_COPILOT_CLIENT_ID;
  merged.RELAY_URL = buildRelayUrl({
    ...merged,
    RELAY_URL: normalizedValues.RELAY_URL || ''
  });
  merged.REMOTE_COPILOT_SHARED_SECRET =
    merged.REMOTE_COPILOT_SHARED_SECRET || '';
  merged.VSCODE_REMOTE_COPILOT_CLIENT_ID = merged.REMOTE_COPILOT_CLIENT_ID;
  merged.VSCODE_REMOTE_COPILOT_RELAY_URL = merged.RELAY_URL;
  merged.VSCODE_REMOTE_COPILOT_SHARED_SECRET =
    merged.REMOTE_COPILOT_SHARED_SECRET;

  return merged;
};

export const readEnvValues = async (envPath: string) => {
  try {
    const content = await readFile(envPath, READ_OPTIONS);
    return parseEnv(content) as EnvValues;
  } catch {
    return {} as EnvValues;
  }
};

export const loadRemoteCopilotEnv = async (
  mode: EnvMode,
  rootDir = process.cwd()
) => {
  const envPath = resolveEnvPath(mode, rootDir);
  const existingValues = await readEnvValues(envPath);

  return {
    envPath,
    values: mergeRemoteCopilotEnvValues(mode, existingValues)
  };
};

export const writeRemoteCopilotEnvFile = async (
  mode: EnvMode,
  values: Partial<EnvValues>,
  template: string,
  rootDir = process.cwd()
) => {
  const envPath = resolveEnvPath(mode, rootDir);
  const finalValues = mergeRemoteCopilotEnvValues(mode, values);
  const content = renderEnvFile(template.trimEnd(), finalValues);

  await writeFile(envPath, content, READ_OPTIONS);

  return {
    envPath,
    values: finalValues
  };
};

export const hasMissingRequiredEnvValues = (values: EnvValues) => {
  return REMOTE_COPILOT_REQUIRED_KEYS.some((key) => {
    return !isMeaningfulValue(values[key]);
  });
};

export const applyEnvValuesToProcess = (values: EnvValues) => {
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
};

export const formatVsCodeSettings = (values: EnvValues) => {
  return [
    'VS Code settings',
    `  "remoteCopilot.clientId": "${values.VSCODE_REMOTE_COPILOT_CLIENT_ID}"`,
    `  "remoteCopilot.relayUrl": "${values.VSCODE_REMOTE_COPILOT_RELAY_URL}"`,
    `  "remoteCopilot.sharedSecret": "${values.VSCODE_REMOTE_COPILOT_SHARED_SECRET}"`
  ].join('\n');
};

export const resolveConfigPath = () => {
  const configBase =
    process.env.APPDATA ??
    process.env.XDG_CONFIG_HOME ??
    path.join(os.homedir(), '.config');

  return path.join(configBase, 'copilot-rc', 'config');
};

export const writeConfigValues = async (
  values: EnvValues,
  configPath: string
) => {
  await mkdir(path.dirname(configPath), { recursive: true });
  const content =
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n';

  await writeFile(configPath, content, READ_OPTIONS);
};

export const fileExists = async (targetPath: string) => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};
