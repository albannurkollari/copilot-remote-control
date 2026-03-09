import { defineConfig } from 'tsup';

const isCI = process.env.CI === 'true';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts'],
  external: ['discord.js', 'ws'],
  format: ['esm'],
  noExternal: ['@remote-copilot/shared'],
  sourcemap: !isCI,
  target: 'node24'
});
