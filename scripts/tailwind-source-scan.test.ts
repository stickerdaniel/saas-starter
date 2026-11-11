import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Scanner } from '@tailwindcss/oxide';
import { describe, expect, it } from 'vitest';
import { sanitizedGitEnv } from './git-context';

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
 * The scan runs over a temporary repository that carries this checkout's tracked
 * ignore files, so its probes never appear in the shared tree.
 */
const repoRoot = path.resolve(import.meta.dirname, '..');

function git(cwd: string, args: string[]): string {
	const result = spawnSync('git', args, { cwd, env: sanitizedGitEnv(), encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	return result.stdout;
}

/** A Git repository holding every tracked `.gitignore` and `.ignore` of this checkout. */
function createIgnoreTree(): string {
	const tree = fs.mkdtempSync(path.join(fs.realpathSync.native(tmpdir()), 'tailwind-scan-'));
	try {
		git(tree, ['init', '--quiet']);
		const ignoreFiles = git(repoRoot, [
			'ls-files',
			'-z',
			'--',
			':(glob)**/.gitignore',
			':(glob)**/.ignore'
		])
			.split('\0')
			.filter(Boolean);
		expect(ignoreFiles).toContain('.gitignore');
		for (const file of ignoreFiles) {
			fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
			fs.copyFileSync(path.join(repoRoot, file), path.join(tree, file));
		}
		return tree;
	} catch (error) {
		fs.rmSync(tree, { recursive: true, force: true });
		throw error;
	}
}

/** Writes `probe.svelte` below `segments` of `tree` and returns its absolute path. */
function probeFile(tree: string, ...segments: string[]): string {
	const directory = path.join(tree, ...segments);
	fs.mkdirSync(directory, { recursive: true });
	const file = path.join(directory, 'probe.svelte');
	fs.writeFileSync(file, '<div class="bg-red-500"></div>\n');
	return file;
}

describe('tailwind source scan', () => {
	it('skips scratch/ and .claude/worktrees/ but still scans src/', () => {
		const tree = createIgnoreTree();
		try {
			const control = probeFile(tree, 'src', 'lib');
			// A nested scratch directory is source: the rule must stay root-anchored.
			const nested = probeFile(tree, 'src', 'lib', 'scratch');
			// Only the worktrees below .claude are parked copies.
			const claude = probeFile(tree, '.claude', 'skills');
			const scratch = probeFile(tree, 'scratch');
			const worktree = probeFile(tree, '.claude', 'worktrees', 'agent');
			const scanner = new Scanner({
				sources: [{ base: tree, pattern: '**/*', negated: false }]
			});
			const files = new Set(scanner.files.map((file) => path.resolve(file)));
			expect(files.has(control)).toBe(true);
			expect(files.has(nested)).toBe(true);
			expect(files.has(claude)).toBe(true);
			expect(files.has(scratch)).toBe(false);
			expect(files.has(worktree)).toBe(false);
		} finally {
			fs.rmSync(tree, { recursive: true, force: true });
		}
	});
});
