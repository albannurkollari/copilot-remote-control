import { defineConfig } from 'tsup';

const isCI = process.env.CI === 'true';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/extension.ts'],
  external: ['vscode'],
  format: ['cjs'],
  noExternal: ['@remote-copilot/shared', 'ws'],
  outExtension: () => ({
    js: '.cjs'
  }),
  splitting: false,
  sourcemap: !isCI,
  target: 'node24'
});
