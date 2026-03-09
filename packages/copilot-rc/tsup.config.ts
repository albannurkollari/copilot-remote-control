import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts'],
  format: ['esm'],
  noExternal: ['@remote-copilot/shared', 'discord.js', 'ws'],
  sourcemap: true,
  target: 'node24'
});
