import { defineConfig } from 'tsup';

const isCI = process.env.CI === 'true';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts'],
  format: ['esm'],
  sourcemap: !isCI,
  target: 'node24'
});
