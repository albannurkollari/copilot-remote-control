import { defineConfig } from 'tsup';

const isCI = process.env.CI === 'true';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts'],
  external: ['discord.js', 'ws'],
  format: ['esm'],
  onSuccess: 'node scripts/copyEnvTemplate.ts',
  platform: 'node',
  sourcemap: !isCI,
  splitting: true,
  target: 'node24'
});
