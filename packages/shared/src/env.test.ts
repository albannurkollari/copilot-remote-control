import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  applyEnvValuesToProcess,
  buildRelayUrl,
  ENV_PRESETS,
  fileExists,
  formatVsCodeSettings,
  hasMissingRequiredEnvValues,
  isMeaningfulValue,
  loadRemoteCopilotEnv,
  mergeRemoteCopilotEnvValues,
  normalizeRelayPath,
  readEnvValues,
  renderEnvFile,
  resolveConfigPath,
  resolveEnvPath,
  writeConfigValues,
  writeRemoteCopilotEnvFile,
  type EnvMode,
  type EnvValues
} from './env.ts';

const createTempDir = async () => {
  return mkdtemp(path.join(os.tmpdir(), 'remote-copilot-env-'));
};

const createEnvValues = (
  mode: EnvMode,
  overrides: Partial<EnvValues> = {}
): EnvValues => {
  return mergeRemoteCopilotEnvValues(mode, {
    DISCORD_APPLICATION_ID: 'app-id',
    DISCORD_GUILD_ID: 'guild-id',
    DISCORD_TOKEN: 'discord-token',
    REMOTE_COPILOT_SHARED_SECRET: 'shared-secret',
    ...overrides
  });
};

const expectEnvFileValues = (
  content: string,
  expected: Record<string, string>
) => {
  for (const [key, value] of Object.entries(expected)) {
    expect(content).toContain(`${key}=${value}`);
  }
};

describe('shared env helpers', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await rm(tempDir, { force: true, recursive: true });
  });

  it('resolves env paths, renders templates, and distinguishes meaningful values and relay path forms', () => {
    expect(resolveEnvPath('dev', tempDir)).toBe(path.join(tempDir, '.env.dev'));
    expect(
      renderEnvFile('APP_ENV={{APP_ENV}}\nRELAY_URL={{RELAY_URL}}', {
        APP_ENV: 'dev',
        RELAY_URL: 'ws://127.0.0.1:8787/'
      })
    ).toBe('APP_ENV=dev\nRELAY_URL=ws://127.0.0.1:8787/\n');
    expect(renderEnvFile('UNKNOWN={{UNKNOWN}}', {})).toBe(
      'UNKNOWN={{UNKNOWN}}\n'
    );

    expect(isMeaningfulValue(undefined)).toBe(false);
    expect(isMeaningfulValue('   ')).toBe(false);
    expect(isMeaningfulValue('replace-with-token')).toBe(false);
    expect(isMeaningfulValue('{{TOKEN}}')).toBe(false);
    expect(isMeaningfulValue('actual-value')).toBe(true);

    expect(normalizeRelayPath('')).toBe('/');
    expect(normalizeRelayPath('/')).toBe('/');
    expect(normalizeRelayPath('relay')).toBe('/relay');
    expect(normalizeRelayPath('/relay')).toBe('/relay');
  });

  it('builds and merges relay env values for dev and prod defaults while preserving meaningful overrides', () => {
    expect(
      buildRelayUrl({
        ...ENV_PRESETS.dev,
        RELAY_URL: 'ws://override.test/'
      })
    ).toBe('ws://override.test/');

    expect(
      buildRelayUrl({
        ...ENV_PRESETS.dev,
        APP_ENV: 'dev',
        RELAY_HOST: 'localhost',
        RELAY_PORT: '9000',
        RELAY_PATH: 'relay',
        RELAY_URL: ''
      })
    ).toBe('ws://localhost:9000/relay');

    expect(
      buildRelayUrl({
        ...ENV_PRESETS.prod,
        APP_ENV: 'prod',
        RELAY_HOST: 'relay.example.com',
        RELAY_PORT: '443',
        RELAY_PATH: '/',
        RELAY_URL: '   '
      })
    ).toBe('wss://relay.example.com:443/');
    expect(
      buildRelayUrl({
        ...ENV_PRESETS.dev,
        APP_ENV: 'dev',
        RELAY_HOST: '',
        RELAY_PORT: '',
        RELAY_PATH: '',
        RELAY_URL: ''
      })
    ).toBe('ws://127.0.0.1:8787/');

    expect(
      mergeRemoteCopilotEnvValues('dev', {
        DISCORD_APPLICATION_ID: 'app-id',
        DISCORD_GUILD_ID: 'guild-id',
        DISCORD_TOKEN: 'discord-token',
        REMOTE_COPILOT_SHARED_SECRET: 'shared-secret',
        RELAY_HOST: 'localhost',
        RELAY_PORT: '9999',
        RELAY_PATH: 'relay',
        RELAY_LOG: '',
        DISCORD_STREAM_UPDATE_MS: '',
        REMOTE_COPILOT_CLIENT_ID: '',
        RELAY_URL: '',
        ignored: undefined as unknown as string
      })
    ).toEqual(
      expect.objectContaining({
        APP_ENV: 'dev',
        RELAY_HOST: 'localhost',
        RELAY_PORT: '9999',
        RELAY_PATH: '/relay',
        RELAY_LOG: 'standard',
        DISCORD_STREAM_UPDATE_MS: '1200',
        REMOTE_COPILOT_CLIENT_ID: 'default',
        RELAY_URL: 'ws://localhost:9999/relay',
        VSCODE_REMOTE_COPILOT_CLIENT_ID: 'default',
        VSCODE_REMOTE_COPILOT_RELAY_URL: 'ws://localhost:9999/relay',
        VSCODE_REMOTE_COPILOT_SHARED_SECRET: 'shared-secret'
      })
    );
    expect(
      mergeRemoteCopilotEnvValues('dev', {
        DISCORD_APPLICATION_ID: 'app-id',
        DISCORD_GUILD_ID: 'guild-id',
        DISCORD_TOKEN: 'discord-token',
        REMOTE_COPILOT_SHARED_SECRET: 'shared-secret',
        DISCORD_STREAM_UPDATE_MS: '2500',
        RELAY_LOG: 'verbose'
      })
    ).toEqual(
      expect.objectContaining({
        DISCORD_STREAM_UPDATE_MS: '2500',
        RELAY_LOG: 'verbose'
      })
    );

    expect(
      mergeRemoteCopilotEnvValues('prod', {
        DISCORD_APPLICATION_ID: 'app-id',
        DISCORD_GUILD_ID: 'guild-id',
        DISCORD_TOKEN: 'discord-token',
        REMOTE_COPILOT_SHARED_SECRET: 'shared-secret',
        REMOTE_COPILOT_CLIENT_ID: 'production-client',
        RELAY_URL: 'wss://relay.example.com/custom'
      })
    ).toEqual(
      expect.objectContaining({
        APP_ENV: 'prod',
        REMOTE_COPILOT_CLIENT_ID: 'production-client',
        RELAY_URL: 'wss://relay.example.com/custom',
        VSCODE_REMOTE_COPILOT_CLIENT_ID: 'production-client',
        VSCODE_REMOTE_COPILOT_RELAY_URL: 'wss://relay.example.com/custom'
      })
    );
  });

  it('reads, loads, and writes env files from disk while reporting file presence and missing required values', async () => {
    const devPath = resolveEnvPath('dev', tempDir);
    const template = [
      'APP_ENV={{APP_ENV}}',
      'DISCORD_APPLICATION_ID={{DISCORD_APPLICATION_ID}}',
      'DISCORD_GUILD_ID={{DISCORD_GUILD_ID}}',
      'DISCORD_TOKEN={{DISCORD_TOKEN}}',
      'RELAY_PATH={{RELAY_PATH}}',
      'RELAY_URL={{RELAY_URL}}',
      'REMOTE_COPILOT_CLIENT_ID={{REMOTE_COPILOT_CLIENT_ID}}',
      'REMOTE_COPILOT_SHARED_SECRET={{REMOTE_COPILOT_SHARED_SECRET}}',
      'VSCODE_REMOTE_COPILOT_CLIENT_ID={{VSCODE_REMOTE_COPILOT_CLIENT_ID}}',
      'VSCODE_REMOTE_COPILOT_RELAY_URL={{VSCODE_REMOTE_COPILOT_RELAY_URL}}',
      'VSCODE_REMOTE_COPILOT_SHARED_SECRET={{VSCODE_REMOTE_COPILOT_SHARED_SECRET}}'
    ].join('\n');

    expect(await fileExists(devPath)).toBe(false);
    expect(await readEnvValues(devPath)).toEqual({});

    await writeFile(
      devPath,
      [
        'APP_ENV=dev',
        'RELAY_PATH=relay',
        'REMOTE_COPILOT_SHARED_SECRET=secret'
      ].join('\n')
    );

    expect(await fileExists(devPath)).toBe(true);
    expect(await readEnvValues(devPath)).toEqual({
      APP_ENV: 'dev',
      RELAY_PATH: 'relay',
      REMOTE_COPILOT_SHARED_SECRET: 'secret'
    });

    expect(await loadRemoteCopilotEnv('dev', tempDir)).toEqual({
      envPath: devPath,
      values: expect.objectContaining({
        APP_ENV: 'dev',
        RELAY_PATH: '/relay',
        REMOTE_COPILOT_SHARED_SECRET: 'secret'
      })
    });

    const written = await writeRemoteCopilotEnvFile(
      'prod',
      createEnvValues('prod', {
        REMOTE_COPILOT_CLIENT_ID: 'prod-client',
        RELAY_HOST: 'relay.example.com',
        RELAY_PORT: '443',
        RELAY_PATH: 'prod'
      }),
      template,
      tempDir
    );

    const writtenContent = await readFile(written.envPath, 'utf8');
    expect(written).toEqual({
      envPath: path.join(tempDir, '.env.prod'),
      values: expect.objectContaining({
        APP_ENV: 'prod',
        RELAY_PATH: '/prod',
        REMOTE_COPILOT_CLIENT_ID: 'prod-client',
        VSCODE_REMOTE_COPILOT_CLIENT_ID: 'prod-client'
      })
    });
    expectEnvFileValues(writtenContent, {
      APP_ENV: 'prod',
      DISCORD_APPLICATION_ID: 'app-id',
      DISCORD_GUILD_ID: 'guild-id',
      DISCORD_TOKEN: 'discord-token',
      RELAY_PATH: '/prod',
      REMOTE_COPILOT_CLIENT_ID: 'prod-client',
      VSCODE_REMOTE_COPILOT_CLIENT_ID: 'prod-client'
    });

    expect(hasMissingRequiredEnvValues(createEnvValues('dev'))).toBe(false);
    expect(
      hasMissingRequiredEnvValues(
        mergeRemoteCopilotEnvValues('dev', {
          DISCORD_APPLICATION_ID: 'replace-with-app-id',
          DISCORD_GUILD_ID: 'guild-id',
          DISCORD_TOKEN: 'discord-token',
          REMOTE_COPILOT_SHARED_SECRET: ''
        })
      )
    ).toBe(true);
  });

  it('resolveConfigPath uses APPDATA, then XDG_CONFIG_HOME, then ~/.config; writeConfigValues writes KEY=VALUE', async () => {
    const originalAppdata = process.env.APPDATA;
    const originalXdg = process.env.XDG_CONFIG_HOME;

    try {
      process.env.APPDATA = path.join(tempDir, 'appdata');
      delete process.env.XDG_CONFIG_HOME;
      expect(resolveConfigPath()).toBe(
        path.join(tempDir, 'appdata', 'copilot-rc', 'config')
      );

      delete process.env.APPDATA;
      process.env.XDG_CONFIG_HOME = path.join(tempDir, 'xdg');
      expect(resolveConfigPath()).toBe(
        path.join(tempDir, 'xdg', 'copilot-rc', 'config')
      );

      delete process.env.APPDATA;
      delete process.env.XDG_CONFIG_HOME;
      const fallbackPath = resolveConfigPath();
      expect(fallbackPath).toMatch(/copilot-rc[/\\]config$/);
      expect(fallbackPath).toContain('.config');

      const configPath = path.join(tempDir, 'copilot-rc', 'nested', 'config');
      await writeConfigValues({ KEY_A: 'val-a', KEY_B: 'val-b' }, configPath);
      expect(await readFile(configPath, 'utf8')).toBe(
        'KEY_A=val-a\nKEY_B=val-b\n'
      );
    } finally {
      if (originalAppdata !== undefined) {
        process.env.APPDATA = originalAppdata;
      } else {
        delete process.env.APPDATA;
      }

      if (originalXdg !== undefined) {
        process.env.XDG_CONFIG_HOME = originalXdg;
      } else {
        delete process.env.XDG_CONFIG_HOME;
      }
    }
  });

  it('applies env values onto process.env and formats the VS Code settings block', () => {
    const values = createEnvValues('dev', {
      REMOTE_COPILOT_CLIENT_ID: 'client-id',
      RELAY_URL: 'ws://127.0.0.1:8787/custom',
      VSCODE_REMOTE_COPILOT_CLIENT_ID: 'client-id',
      VSCODE_REMOTE_COPILOT_RELAY_URL: 'ws://127.0.0.1:8787/custom',
      VSCODE_REMOTE_COPILOT_SHARED_SECRET: 'shared-secret'
    });

    applyEnvValuesToProcess({
      TEST_REMOTE_COPILOT_A: 'one',
      TEST_REMOTE_COPILOT_B: 'two'
    });

    expect(process.env.TEST_REMOTE_COPILOT_A).toBe('one');
    expect(process.env.TEST_REMOTE_COPILOT_B).toBe('two');
    expect(formatVsCodeSettings(values)).toBe(
      [
        'VS Code settings',
        '  "remoteCopilot.clientId": "client-id"',
        '  "remoteCopilot.relayUrl": "ws://127.0.0.1:8787/custom"',
        '  "remoteCopilot.sharedSecret": "shared-secret"'
      ].join('\n')
    );
  });
});
