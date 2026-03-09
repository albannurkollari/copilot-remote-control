import { defineConfig } from 'tsup';

const isCI = process.env.CI === 'true';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts'],
  format: ['esm'],
  noExternal: ['@remote-copilot/shared', 'discord.js', 'ws'],
  sourcemap: !isCI,
  target: 'node24'
});
