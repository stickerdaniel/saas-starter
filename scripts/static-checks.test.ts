/**
 * The gate must never report success without doing the work.
 *
 * It used to. Eleven inputs made it print "All checks passed!" and exit 0 having
 * checked nothing, and the class kept reappearing because each check derived its
 * own file set and no one place could see that none of them had run.
 *
 * These tests pin the two things that keep it closed:
 *   1. Every caller path is normalized to repo-relative BEFORE it meets a route.
 *      This is load-bearing, not cosmetic: the route predicates gate on a `src/`
 *      prefix, so an absolute path is invisible to them. The test asserts both
 *      halves so the reason survives, since a future reader who sees only the
 *      normalization may reasonably think it is tidiness and drop it.
 *   2. Bad input dies at the boundary. Every case below exits before a check runs,
 *      so these stay fast.
 */
import { spawnSync } from 'child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { sanitizedGitEnv } from './git-context';
import {
	authoredTextFiles,
	existingRepositoryPaths,
	formatPathForDiagnostic,
	isIgnoredPath,
	literalControlCharacterViolations,
	repositoryPaths,
	ROUTES,
	resolveInputs,
	spellcheckFiles,
	unsafePathCodepoints
} from './static-checks';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'static-checks.ts');

/** Exit code only. Every case here fails at intake, so no check subprocess runs. */
function run(...args: string[]): number {
	return spawnSync('bun', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' }).status ?? -1;
}

describe('route predicates', () => {
	it('routes knowledge files through repository policy candidates and ignores', () => {
		expect(ROUTES['knowledge-placement']('README.md')).toBe(true);
		expect(ROUTES['knowledge-placement']('src/example.ts')).toBe(true);
		expect(ROUTES['knowledge-placement']('references/example.md')).toBe(false);
		expect(ROUTES['knowledge-placement']('static/logo.svg')).toBe(false);
	});

	it('routes authored Markdown and text through the literal control-character guard', () => {
		expect(ROUTES['literal-control-char']('src/lib/content/legal/privacy.md')).toBe(true);
		expect(ROUTES['literal-control-char']('src/lib/content/llms.txt')).toBe(true);
		expect(ROUTES['literal-control-char']('src/lib/content/privacy.ts')).toBe(false);
		expect(ROUTES['literal-control-char']('scratch/session/log.txt')).toBe(false);
	});

	it('keeps artifact ignores rooted and includes tracked dot-directory documents', () => {
		expect(isIgnoredPath('scratch/session/log.md')).toBe(true);
		expect(isIgnoredPath('src/lib/scratch/editor.ts')).toBe(false);
		const files = [
			'.agents/skills/example.md',
			'references/example.md',
			'scratch/session/log.md',
			'src/lib/scratch/editor.md'
		];
		expect(authoredTextFiles(files)).toEqual([
			'.agents/skills/example.md',
			'src/lib/scratch/editor.md'
		]);
		expect(spellcheckFiles(files)).toEqual([
			'.agents/skills/example.md',
			'src/lib/scratch/editor.md'
		]);
	});

	it('are blind to an absolute path, which is why normalization is load-bearing', () => {
		const absolute = path.join(ROOT, 'src/lib/utils/auth-messages.ts');
		const absoluteConvex = path.join(ROOT, 'src/lib/convex/schema.ts');

		// The trap: both gates test a `src/` prefix, so an absolute path routes nowhere
		// and the checks silently skip while the run still reports success.
		expect(ROUTES['banned-patterns'](absolute)).toBe(false);
		expect(ROUTES.convex(absoluteConvex)).toBe(false);

		// The defence: normalize first, and the same files route.
		expect(ROUTES['banned-patterns'](resolveInputs([absolute], 'test')[0])).toBe(true);
		expect(ROUTES.convex(resolveInputs([absoluteConvex], 'test')[0])).toBe(true);
	});
});

describe('literal control-character scan', () => {
	it.each([
		['C0', 0x1b, 'U+001B'],
		['DEL', 0x7f, 'U+007F'],
		['C1', 0x85, 'U+0085'],
		['bidi', 0x202e, 'U+202E']
	])('flags %s characters in authored text', (_label, code, codepoint) => {
		const violations = literalControlCharacterViolations(
			'src/lib/content/llms.txt',
			`safe${String.fromCharCode(code)}text`
		);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain(codepoint);
		expect(violations[0]).toContain('Remove it or replace it with visible whitespace');
		expect(violations[0]).toContain(`\\u${code.toString(16).padStart(4, '0').toUpperCase()}`);
	});
});

describe('repository path safety', () => {
	it('keeps missing tracked files out of full-mode content readers', () => {
		expect(existingRepositoryPaths(['README.md', 'docs/does-not-exist.md'])).toEqual(['README.md']);
	});

	it('includes untracked nonignored files in the full-mode preflight', () => {
		const relative = `src/lib/content/.static-checks-untracked-${process.pid}.md`;
		const file = path.join(ROOT, relative);
		writeFileSync(file, 'safe');
		try {
			expect(repositoryPaths()).toContain(relative);
		} finally {
			rmSync(file, { force: true });
		}
	});

	it('encodes unsafe path characters in diagnostics', () => {
		expect(formatPathForDiagnostic(`bad${String.fromCharCode(0x1b)}.txt`)).toBe(
			'"bad\\\\u001B.txt"'
		);
	});

	it('rejects a malicious filename before subprocesses run without printing its payload', () => {
		const directory = path.join(ROOT, 'scratch', 'static-checks-path-test');
		mkdirSync(directory, { recursive: true });
		const offender = `${String.fromCharCode(0x1b)}]0;OWNED${String.fromCharCode(0x07)}`;
		const file = path.join(directory, `bad${offender}.txt`);
		writeFileSync(file, 'safe');
		try {
			const result = spawnSync('bun', [SCRIPT, file], {
				cwd: ROOT,
				encoding: 'utf8',
				env: sanitizedGitEnv()
			});
			const output = `${result.stdout}${result.stderr}`;
			expect(result.status).toBe(1);
			expect(output).toContain('U+001B');
			expect(output).not.toContain(offender);
			expect(output).not.toContain(String.fromCharCode(0x07));
			expect(output).not.toContain('SvelteKit sync');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === 'win32')(
		'rejects an unsafe symlink name before resolving its target',
		() => {
			const directory = path.join(ROOT, 'scratch', 'static-checks-symlink-test');
			mkdirSync(directory, { recursive: true });
			const offender = String.fromCharCode(0x202e);
			const file = path.join(directory, `unsafe${offender}.md`);
			symlinkSync(path.join(ROOT, 'README.md'), file);
			try {
				const result = spawnSync('bun', [SCRIPT, file], {
					cwd: ROOT,
					encoding: 'utf8',
					env: sanitizedGitEnv()
				});
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status).toBe(1);
				expect(output).toContain('U+202E');
				expect(output).not.toContain(offender);
				expect(output).not.toContain('SvelteKit sync');
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
		10_000
	);

	it('identifies structural, line-separator, and bidirectional controls in paths', () => {
		for (const code of [0x09, 0x0a, 0x0d, 0x7f, 0x85, 0x2028, 0x2029, 0x202e]) {
			expect(unsafePathCodepoints(`bad${String.fromCharCode(code)}.txt`)).toHaveLength(1);
		}
	});
});

describe('resolveInputs', () => {
	it('normalizes every spelling of the same file to one repo-relative path', () => {
		const forms = [
			path.join(ROOT, 'src/lib/utils/auth-messages.ts'),
			'./src/lib/utils/auth-messages.ts',
			'src/lib/utils/../utils/auth-messages.ts',
			'src/lib/utils/auth-messages.ts'
		];
		expect(resolveInputs(forms, 'test')).toEqual(['src/lib/utils/auth-messages.ts']);
	});

	it('includes dot-directory descendants of a directory argument', () => {
		const directory = path.join(ROOT, 'src', '.static-checks-directory-test');
		const file = path.join(directory, 'instructions.md');
		mkdirSync(directory, { recursive: true });
		writeFileSync(file, 'safe');
		try {
			expect(resolveInputs([path.join(ROOT, 'src')], 'test')).toContain(
				'src/.static-checks-directory-test/instructions.md'
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe('bad input dies at the boundary', () => {
	it.each([
		['an empty argument', ['']],
		['a whitespace argument', ['   ']],
		['a newline-joined list arriving as one argument', ['src/a.ts\nsrc/b.ts']],
		['a path that does not exist', ['src/does-not-exist.ts']],
		['a path outside the repository', ['/etc/hosts']],
		['an unknown flag', ['--CI', '--scope', 'lint']],
		['a misspelled flag whose value would leak into the file list', ['--scop', 'lint']]
	])('rejects %s', (_label, args) => {
		expect(run(...args)).toBe(1);
	});

	// `--staged` is the one case here that is not bad input, so it has to be asserted
	// or nothing pins that the guards above leave it alone.
	//
	// It reads the real git index, which is the developer's, so with anything staged
	// it lints those files for real and outruns vitest's default per-test timeout,
	// which nothing here raises. The index cannot be
	// substituted from outside either: `sanitizedGitEnv` scrubs `GIT_INDEX_FILE`
	// deliberately, because a pre-commit framework setting it points the run at the
	// wrong worktree (#332). CI stages nothing, so the assertion always runs where it
	// gates a merge, and a developer mid-commit gets a skip with the reason instead of
	// a timeout that looks like a broken script.
	const nothingStaged =
		spawnSync('git', ['diff', '--cached', '--quiet'], {
			cwd: ROOT,
			env: sanitizedGitEnv()
		}).status === 0;
	it.skipIf(!nothingStaged)('still accepts a run with nothing staged', () => {
		expect(run('--staged', '--scope', 'lint')).toBe(0);
	});
});
