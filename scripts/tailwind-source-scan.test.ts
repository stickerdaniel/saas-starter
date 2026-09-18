import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Scanner } from '@tailwindcss/oxide';
import { afterEach, describe, expect, it } from 'vitest';

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

function probeDir(relative: string): string {
	const dir = path.join(repoRoot, relative, `scan-probe-${randomBytes(6).toString('hex')}`);
	fs.mkdirSync(dir, { recursive: true });
	created.push(dir);
	fs.writeFileSync(path.join(dir, 'probe.svelte'), '<div class="bg-red-500"></div>\n');
	return dir;
}

afterEach(() => {
	for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('tailwind source scan', () => {
	it('skips scratch/ and .claude/worktrees/ but still scans src/', () => {
		const control = probeDir('src/lib');
		const scratch = probeDir('scratch');
		const worktree = probeDir('.claude/worktrees');
		const scanner = new Scanner({
			sources: [{ base: repoRoot, pattern: '**/*', negated: false }]
		});
		const files = new Set(scanner.files.map((file) => path.resolve(file)));
		expect(files.has(path.join(control, 'probe.svelte'))).toBe(true);
		expect(files.has(path.join(scratch, 'probe.svelte'))).toBe(false);
		expect(files.has(path.join(worktree, 'probe.svelte'))).toBe(false);
	});
});
