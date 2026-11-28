import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareCodeUnits } from '../../.agents/skills/upstream-sync/scripts/apply-layout.ts';
import { StaleInput, type Run } from './run.ts';

const PRETTIER = createRequire(import.meta.url).resolve('prettier/bin/prettier.cjs');
const BATCH = 200;
const RESOLVING_PLUGIN = 'prettier-plugin-tailwindcss';

export function formattedFiles(run: Pick<Run, 'written' | 'rewrites'>): string[] {
	return [...new Set([...run.written, ...run.rewrites.map(({ file }) => file)])].sort(
		compareCodeUnits
	);
}

export function formatConfig(config: Record<string, unknown>): Record<string, unknown> {
	const plugins = Array.isArray(config.plugins) ? config.plugins : [];
	return Object.fromEntries(
		Object.entries({
			...config,
			plugins: plugins.filter((plugin) => plugin !== RESOLVING_PLUGIN)
		}).filter(([key]) => !key.startsWith('tailwind'))
	);
}

export function formatTree(run: Run): void {
	const files = formattedFiles(run);
	const root = join(run.checkout, '.prettierrc');
	const scratch = mkdtempSync(join(tmpdir(), 'layout-format-'));
	const config = join(scratch, 'prettierrc.json');
	try {
		writeFileSync(
			config,
			JSON.stringify(formatConfig(existsSync(root) ? JSON.parse(readFileSync(root, 'utf8')) : {}))
		);
		for (let at = 0; at < files.length; at += BATCH) {
			const result = spawnSync(
				process.execPath,
				[
					PRETTIER,
					'--config',
					config,
					'--write',
					'--ignore-unknown',
					'--log-level=warn',
					...files.slice(at, at + BATCH)
				],
				{ cwd: run.checkout, encoding: 'utf8' }
			);
			if (result.status !== 0) {
				throw new StaleInput(`Prettier cannot format the tree:\n${result.stderr.trimEnd()}`);
			}
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}
