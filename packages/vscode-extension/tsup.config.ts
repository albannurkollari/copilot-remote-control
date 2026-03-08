import { defineConfig } from 'tsup';

export default defineConfig({
	clean: true,
	dts: true,
	entry: ['src/index.ts', 'src/extension.ts'],
	external: ['vscode'],
	format: ['esm'],
	sourcemap: true,
	target: 'node24'
});
