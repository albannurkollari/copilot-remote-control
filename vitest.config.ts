import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const workspacePackageAliases = {
  '@remote-copilot/shared': fileURLToPath(
    new URL('./packages/shared/src/index.ts', import.meta.url)
  ),
  '@remote-copilot/relay-server': fileURLToPath(
    new URL('./packages/relay-server/src/index.ts', import.meta.url)
  ),
  '@remote-copilot/discord-bot': fileURLToPath(
    new URL('./packages/discord-bot/src/index.ts', import.meta.url)
  ),
  '@remote-copilot/vscode-extension': fileURLToPath(
    new URL('./packages/vscode-extension/src/index.ts', import.meta.url)
  )
};

export default defineConfig({
  resolve: {
    alias: workspacePackageAliases
  },
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: '@remote-copilot/shared',
          root: 'packages/shared'
        }
      },
      {
        extends: true,
        test: {
          name: '@remote-copilot/relay-server',
          root: 'packages/relay-server'
        }
      },
      {
        extends: true,
        test: {
          name: '@remote-copilot/discord-bot',
          root: 'packages/discord-bot'
        }
      },
      {
        extends: true,
        test: {
          name: '@remote-copilot/vscode-extension',
          root: 'packages/vscode-extension'
        }
      }
    ],
    coverage: {
      clean: true,
      enabled: true,
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'scripts/**',
        '**/coverage/**',
        '**/dist/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/src/index.ts',
        '**/tsup.config.ts',
        'vitest.config.ts'
      ],
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: 'coverage'
    },
    reporters: [
      'default',
      ['junit', { outputFile: 'coverage/junit.xml' }],
      ['json', { outputFile: 'coverage/test-results.json' }]
    ]
  }
});
