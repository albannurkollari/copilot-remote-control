import { defineConfig } from 'vitest/config';

export default defineConfig({
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
