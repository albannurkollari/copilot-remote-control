import { defineConfig } from 'tsup';

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
  sourcemap: true,
  target: 'node24'
});
