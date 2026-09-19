import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { sanitizedGitEnv } from './git-context';
import { SOURCE_FIXTURE_DIRECTORY } from './source-tree';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The two spellings a test uses to bind the real checkout root, capturing the identifier it
 * binds. Anything else a test joins `src` onto is a throwaway checkout under `tmpdir()`,
 * which no suite walks and which therefore cannot race anyone.
 */
const ROOT_BINDING =
	/const\s+([A-Za-z_$][\w$]*)\s*=\s*path\.resolve\(\s*(?:import\.meta\.dirname|path\.dirname\(fileURLToPath\(import\.meta\.url\)\))\s*,\s*'\.\.'\s*\)/g;

/** Tracked test sources, listed by Git so the scan does not walk `node_modules`. */
function testFiles(): string[] {
	const result = spawnSync('git', ['ls-files', '-z', '--', '*.test.ts'], {
		cwd: ROOT,
		encoding: 'utf8',
		env: sanitizedGitEnv()
	});
	if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
	return result.stdout.split('\0').filter(Boolean);
}

function lineOf(source: string, index: number): number {
	return source.slice(0, index).split('\n').length;
}

/**
 * A fixture that appears and vanishes directly under `src/` sits in the path of every suite
 * that walks that tree, and a walk which listed the entry before its owner removed it dies
 * on `ENOENT scandir` while the owning suite stays green. Two suites reintroduced that race
 * after it was first fixed, so the placement rule is checked rather than remembered.
 *
 * A separate `'src'` segment joined onto the checkout root is the shape that builds such a
 * path; a single `'src/lib/...'` literal names existing source and is left alone.
 */
describe('transient source-tree fixtures', () => {
	it('are built inside SOURCE_FIXTURE_ROOT, never directly under src/', () => {
		const offenders: string[] = [];
		let bindings = 0;

		for (const file of testFiles()) {
			const source = readFileSync(path.join(ROOT, file), 'utf8');
			const roots = [...source.matchAll(ROOT_BINDING)].map((match) => match[1]);
			bindings += roots.length;
			for (const root of roots) {
				const joined = new RegExp(`\\bjoin\\(\\s*${root}\\s*,\\s*['"]src['"]\\s*,`, 'g');
				for (const match of source.matchAll(joined)) {
					offenders.push(`${file}:${lineOf(source, match.index)}`);
				}
			}
		}

		// Without this the scan reports a clean result when the binding spelling drifts, which
		// is exactly how an exclusion stops protecting anything without failing anything.
		expect(
			bindings,
			'No test file binds the checkout root; the scan matched nothing.'
		).toBeGreaterThan(0);
		expect(
			offenders,
			`Build these under SOURCE_FIXTURE_ROOT (src/${SOURCE_FIXTURE_DIRECTORY}), the one directory the source-tree walks skip by name.`
		).toEqual([]);
	});
});
