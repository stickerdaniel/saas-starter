import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Scanner } from '@tailwindcss/oxide';
import { afterEach, describe, expect, it } from 'vitest';
import { SOURCE_FIXTURE_ROOT } from './source-tree';

/**
 * Tailwind's oxide scanner decides which files feed the CSS source scan from the
 * repository's own `.gitignore` files only: it disables the global git excludes
 * (`WalkBuilder::git_global(false)`), so a `scratch/` rule that lives solely in
 * `~/.config/git/ignore` leaves every session artifact in the scan. Measured on
 * a 48 GB scratch tree: 240 720 files in 43 s instead of 2 955 in 0.6 s, which
 * starved Vite's SSR module runner and turned every dev page into a 500.
 *
 * This reads the answer from the scanner itself rather than from the ignore
 * file's text, so it fails for any reason the rule stops reaching the consumer.
 * If the rule is missing while a large scratch tree exists, the scan is slow:
 * that slowness is the defect being guarded, not a flaky test.
 */
const repoRoot = path.resolve(import.meta.dirname, '..');
const created: string[] = [];

/**
 * Writes `probe.svelte` under a randomly named directory in `parent`, optionally below
 * further `segments`, and returns the absolute file path. The randomized directory is the
 * unit that gets removed, so a probe's whole tree disappears with it.
 */
function probeFile(parent: string, ...segments: string[]): string {
	const probeRoot = path.join(parent, `scan-probe-${randomBytes(6).toString('hex')}`);
	const dir = path.join(probeRoot, ...segments);
	fs.mkdirSync(dir, { recursive: true });
	created.push(probeRoot);
	const file = path.join(dir, 'probe.svelte');
	fs.writeFileSync(file, '<div class="bg-red-500"></div>\n');
	return file;
}

/**
 * Every probe this suite creates under `src/` has to sit inside SOURCE_FIXTURE_ROOT, the
 * one directory the recursive source walks skip by name. A probe parked anywhere else in
 * `src/` appears and vanishes in the path of those walks, and a walk that listed it before
 * this suite removed it dies on `ENOENT scandir` while this suite still passes.
 */
function expectParkedInFixtureRoot(file: string): void {
	const relative = path.relative(SOURCE_FIXTURE_ROOT, file);
	const parked = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
	expect(parked, `Build this probe inside SOURCE_FIXTURE_ROOT, not at ${file}`).toBe(true);
}

afterEach(() => {
	for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('tailwind source scan', () => {
	it('skips scratch/ and .claude/worktrees/ but still scans src/', () => {
		const control = probeFile(SOURCE_FIXTURE_ROOT);
		// A nested scratch directory is source: the rule must stay root-anchored.
		const nested = probeFile(SOURCE_FIXTURE_ROOT, 'scratch');
		expectParkedInFixtureRoot(control);
		expectParkedInFixtureRoot(nested);
		const scratch = probeFile(path.join(repoRoot, 'scratch'));
		const worktree = probeFile(path.join(repoRoot, '.claude', 'worktrees'));
		const scanner = new Scanner({
			sources: [{ base: repoRoot, pattern: '**/*', negated: false }]
		});
		const files = new Set(scanner.files.map((file) => path.resolve(file)));
		expect(files.has(control)).toBe(true);
		expect(files.has(nested)).toBe(true);
		expect(files.has(scratch)).toBe(false);
		expect(files.has(worktree)).toBe(false);
	});
});
