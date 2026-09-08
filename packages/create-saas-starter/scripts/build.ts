import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare const Bun: {
	build(options: {
		entrypoints: string[];
		outdir: string;
		target: 'node';
		format: 'esm';
		external: string[];
		naming: string;
		sourcemap: 'external';
	}): Promise<{ success: boolean; logs: unknown[] }>;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir);

const result = await Bun.build({
	entrypoints: [path.join(root, 'src/index.ts')],
	outdir,
	target: 'node',
	format: 'esm',
	external: ['@clack/prompts', 'tar'],
	naming: 'index.js',
	sourcemap: 'external'
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

await chmod(path.join(outdir, 'index.js'), 0o755);
await copyFile(
	path.resolve(root, '../../scripts/windows-job-runner.ps1'),
	path.join(outdir, 'windows-job-runner.ps1')
);
