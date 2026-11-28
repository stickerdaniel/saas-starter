import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testExecutable } from './test-executable';

const ROOT = path.resolve(import.meta.dirname, '..');
const BUN = testExecutable('bun');
const PLANTED = 'BUN_DOTENV_LOADER_PLANTED';
const CREATOR = 'packages/create-saas-starter';
const INHERITED_LOADER_INPUTS = [PLANTED, 'BUN_OPTIONS'];

const manifest: { workspaces?: string[] } = JSON.parse(
	readFileSync(path.join(ROOT, 'package.json'), 'utf8')
);
const directories = [
	'.',
	...(manifest.workspaces ?? []),
	...(existsSync(path.join(ROOT, CREATOR)) ? [CREATOR] : [])
];

const scratches: string[] = [];

afterEach(() => {
	for (const scratch of scratches.splice(0)) rmSync(scratch, { recursive: true, force: true });
});

function plantedValue(cwd: string, flags: string[]): unknown {
	const env = { ...process.env };
	for (const name of INHERITED_LOADER_INPUTS) delete env[name];
	const result = spawnSync(
		BUN,
		[...flags, '-e', `console.log(JSON.stringify(process.env.${PLANTED} ?? null))`],
		{ cwd, env, encoding: 'utf8' }
	);
	expect(result.stderr).toBe('');
	expect(result.status).toBe(0);
	return JSON.parse(result.stdout);
}

describe("Bun's default dotenv loader", () => {
	it.each(directories)('stays off under the bunfig.toml of %s', (directory) => {
		const config = path.join(ROOT, directory, 'bunfig.toml');
		expect(existsSync(config), `${directory} has no bunfig.toml`).toBe(true);
		const scratch = mkdtempSync(path.join(tmpdir(), 'bun-dotenv-loader-'));
		scratches.push(scratch);
		copyFileSync(config, path.join(scratch, 'bunfig.toml'));
		writeFileSync(path.join(scratch, '.env'), `${PLANTED}=planted\n`);

		expect(plantedValue(scratch, ['--env-file=.env'])).toBe('planted');
		expect(plantedValue(scratch, [])).toBeNull();
	});
});
