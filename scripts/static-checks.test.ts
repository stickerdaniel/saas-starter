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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { sanitizedGitEnv } from './git-context';
import {
	argumentBatches,
	authoredTextFiles,
	existingRepositoryPaths,
	formatPathForDiagnostic,
	isIgnoredPath,
	literalControlCharacterViolations,
	prettierArguments,
	prettierFormattableFiles,
	prettierProjectPaths,
	prettierTraversalPaths,
	repositoryPaths,
	ROUTES,
	resolveInputs,
	spellcheckFiles,
	unsafePathCodepoints,
	usesAssertOnlyChecks
} from './static-checks';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'static-checks.ts');

/** Exit code only. Every case here fails at intake, so no check subprocess runs. */
function run(...args: string[]): number {
	return spawnSync('bun', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' }).status ?? -1;
}

describe('checker mutation mode', () => {
	it('keeps staged and CI runs assert-only', () => {
		expect(usesAssertOnlyChecks(false, 'staged')).toBe(true);
		expect(usesAssertOnlyChecks(true, 'full')).toBe(true);
		expect(usesAssertOnlyChecks(false, 'files')).toBe(false);
	});

	it('batches structured arguments by both file count and command length', () => {
		expect(argumentBatches(['a.ts', 'b.ts', 'c.ts'], ['prettier'], 1_000, 2)).toEqual([
			['a.ts', 'b.ts'],
			['c.ts']
		]);
		expect(argumentBatches(['aaaa.ts', 'bbbb.ts'], ['command'], 20, 100)).toEqual([
			['aaaa.ts'],
			['bbbb.ts']
		]);
	});
});

describe('Prettier invocation', () => {
	// The project run used to take neither --ignore-unknown nor the plugins while the
	// file-scoped run passed plugins on the command line, so the two could disagree about
	// what a given file even is. Both are built here now, and neither names a plugin:
	// .prettierrc declares them once and every run reads that.
	it('gives the project run and the file-scoped run the same contract', () => {
		const project = prettierArguments('--check');
		const scoped = prettierArguments('--check', ['src/app.ts']);

		expect(project.at(-1)).toBe('.');
		expect(scoped.slice(-2)).toEqual(['--', 'src/app.ts']);

		const projectOptions = project.slice(0, -1);
		const scopedOptions = scoped.slice(0, scoped.indexOf('--'));
		expect(projectOptions).toEqual(scopedOptions);
		expect(projectOptions).toContain('--ignore-unknown');
		expect(projectOptions).not.toContain('--plugin');
		expect(prettierArguments('--write', ['a.ts'])).toContain('--write');
	});
});

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

	// The Prettier route is the one route that is not a path predicate. It used to be a
	// hand-written extension grammar, which is a copy of a table Prettier owns and which
	// had drifted: every filename in the second group is formatted by Prettier and none
	// of them matched, so a file-scoped run skipped them and called itself green.
	it('asks Prettier which files it can parse', async () => {
		const formattable = [
			'.prettierrc',
			'config.jsonc',
			'workflow.yaml',
			'query.graphql',
			'page.mdx',
			'static/site.webmanifest',
			'README.markdown',
			'.babelrc',
			'boundaries.geojson',
			'campaign.mjml'
		];
		expect(await prettierFormattableFiles(formattable)).toEqual(formattable);
		expect(await prettierFormattableFiles(['static/image.png', 'notes.txt', 'Dockerfile'])).toEqual(
			[]
		);
	});

	// .prettierrc is where this repository declares its formatter contract, and the
	// formatter subprocess is what reads it. The checker cannot: resolving configuration
	// to answer a routing question would run a config file and a plugin in the checker's
	// own process. So the route carries one narrow convention instead, and its licence is
	// the declaration pinned here.
	it('takes the Svelte contract from the repository configuration', async () => {
		const config = JSON.parse(readFileSync(path.join(ROOT, '.prettierrc'), 'utf8')) as {
			plugins?: string[];
			overrides?: Array<{ files?: string; options?: { parser?: string } }>;
		};
		expect(config.plugins).toContain('prettier-plugin-svelte');
		expect(
			config.overrides?.some(
				(override) => override.files === '*.svelte' && override.options?.parser === 'svelte'
			)
		).toBe(true);

		// Classification resolves the same config and plugin list as the formatter, so mixed
		// case follows Prettier's own extension matching rather than a local fallback grammar.
		expect(
			await prettierFormattableFiles(['src/routes/+layout.svelte', 'src/routes/Component.SVELTE'])
		).toEqual(['src/routes/+layout.svelte', 'src/routes/Component.SVELTE']);
	});

	it('honours a parser override from repository configuration', async () => {
		const fixture = mkdtempSync(path.join(tmpdir(), 'static-checks-config-'));
		try {
			writeFileSync(
				path.join(fixture, '.prettierrc'),
				JSON.stringify({ overrides: [{ files: '*.customfmt', options: { parser: 'typescript' } }] })
			);
			writeFileSync(path.join(fixture, 'probe.customfmt'), 'export const probe = 1;\n');
			expect(await prettierFormattableFiles(['probe.customfmt'], fixture)).toEqual([
				'probe.customfmt'
			]);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	it('applies the ignore rules the formatter CLI applies', async () => {
		// The CLI's default --ignore-path is exactly [.gitignore, .prettierignore]. Files
		// its project traversal skips must stay out of the ledger too.
		expect(
			await prettierFormattableFiles(['src/env.d.ts', 'scratch/probe.ts', 'CLAUDE.md'])
		).toEqual([]);
		expect(
			await prettierFormattableFiles([
				'src/routes/+layout.svelte',
				'src/lib/scratch/probe.ts',
				'src/env.d.ts'
			])
		).toEqual(['src/routes/+layout.svelte', 'src/lib/scratch/probe.ts']);
	});

	it('keeps a run honest about which named files it formatted', async () => {
		// The count the ledger reports has to be the count Prettier can act on. A named
		// file it cannot parse is not formatter work, and calling it work would let a run
		// of nothing but unparseable inputs report success.
		expect(await prettierFormattableFiles(['README.markdown', 'static/image.png'])).toEqual([
			'README.markdown'
		]);
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

	it('routes upstream-report TypeScript through its dedicated project', () => {
		expect(
			ROUTES['skill-types']('.agents/skills/upstream-report/scripts/upstream-relevance.ts')
		).toBe(true);
		expect(ROUTES['skill-types']('.agents/skills/upstream-report/tsconfig.json')).toBe(true);
		expect(ROUTES['skill-types']('.agents/skills/upstream-report/helper.ts')).toBe(false);
		expect(ROUTES['skill-types']('.agents/skills/upstream-report/SKILL.md')).toBe(false);
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

	it('preflights a positive formatter match count for the whole project', async () => {
		const traversed = await prettierTraversalPaths();
		const formattable = await prettierFormattableFiles(prettierProjectPaths(traversed));

		expect(formattable.length).toBeGreaterThan(0);
		expect(formattable.length).toBeLessThanOrEqual(traversed.length);
		expect(formattable).not.toContain('src/env.d.ts');
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

	it('counts files Prettier visits even when local Git configuration ignores them', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'static-checks-local-ignore-'));
		const excludes = path.join(directory, 'excludes');
		const relative = `.static-checks-local-ignore-${process.pid}.json`;
		const file = path.join(ROOT, relative);
		const saved = new Map<string, string | undefined>();
		for (const key of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) {
			saved.set(key, process.env[key]);
		}
		writeFileSync(excludes, `${relative}\n`);
		writeFileSync(file, '{"safe": true}\n');
		process.env.GIT_CONFIG_COUNT = '1';
		process.env.GIT_CONFIG_KEY_0 = 'core.excludesFile';
		process.env.GIT_CONFIG_VALUE_0 = excludes;
		try {
			expect(repositoryPaths()).not.toContain(relative);
			expect(await prettierTraversalPaths()).toContain(relative);
			expect(await prettierFormattableFiles([relative])).toEqual([relative]);
		} finally {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			rmSync(file, { force: true });
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === 'win32')(
		'skips session artifacts and Sapling metadata without guessing file-level ignores',
		async () => {
			const fixture = mkdtempSync(path.join(tmpdir(), 'prettier-traversal-'));
			mkdirSync(path.join(fixture, 'scratch'));
			mkdirSync(path.join(fixture, '.sl'));
			mkdirSync(path.join(fixture, 'src', '__fixtures__'), { recursive: true });
			writeFileSync(path.join(fixture, '.gitignore'), '');
			writeFileSync(path.join(fixture, '.prettierignore'), '/scratch/\n**/__fixtures__/*.ts\n');
			writeFileSync(path.join(fixture, 'scratch', 'bad\n.ts'), 'unsafe');
			writeFileSync(path.join(fixture, '.sl', 'probe.ts'), 'metadata');
			writeFileSync(path.join(fixture, 'src', 'good.ts'), 'source');
			writeFileSync(path.join(fixture, 'src', '__fixtures__', 'README.md'), 'markdown');
			try {
				const files = await prettierTraversalPaths(fixture, true);
				expect(files).toContain('src/good.ts');
				expect(files).toContain('src/__fixtures__/README.md');
				expect(files).not.toContain('scratch/bad\n.ts');
				expect(files).not.toContain('.sl/probe.ts');
			} finally {
				rmSync(fixture, { recursive: true, force: true });
			}
		}
	);

	it.skipIf(process.platform === 'win32')(
		'keeps symlinks out of the project formatter ledger',
		() => {
			const relative = `.static-checks-prettier-link-${process.pid}.md`;
			const file = path.join(ROOT, relative);
			symlinkSync(path.join(ROOT, 'README.md'), file);
			try {
				expect(repositoryPaths()).toContain(relative);
				// The formatter scope keeps the link's own name, because Prettier neither follows
				// nor accepts one, and the project ledger is what drops it.
				expect(resolveInputs([file], 'test', process.cwd(), repositoryPaths, false)).toEqual([
					relative
				]);
				expect(prettierProjectPaths([relative])).toEqual([]);
				// Every other scope routes by extension, so it needs the target instead: under the
				// link's own `.md` name a TypeScript target reaches no checker and the run passes
				// having checked nothing.
				expect(resolveInputs([file], 'test')).toEqual(['README.md']);
			} finally {
				rmSync(file, { force: true });
			}
		}
	);

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

	it('identifies structural, invisible, line-separator, and bidirectional controls in paths', () => {
		for (const code of [0x09, 0x0a, 0x0d, 0x7f, 0x85, 0x2028, 0x2029, 0x202e, 0xfeff, 0xfffd]) {
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

	// Containment is a segment question, not a prefix question: "..valid.ts" is an
	// ordinary file at the repository root, and only "..", a real ".." segment, or an
	// absolute result (a different Windows drive) is outside.
	it('keeps a root file whose name begins with dots', () => {
		const file = path.join(ROOT, `..resolve-dots-${process.pid}.ts`);
		writeFileSync(file, 'export const valid = true;\n');
		try {
			expect(resolveInputs([file], 'test')).toEqual([path.basename(file)]);
		} finally {
			rmSync(file, { force: true });
		}
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

	it.skipIf(process.platform === 'win32')(
		'accepts a directory whose files were already named',
		() => {
			const directory = path.join(ROOT, `.static-checks-overlap-target-${process.pid}`);
			const link = path.join(ROOT, `.static-checks-overlap-link-${process.pid}`);
			const file = path.join(directory, 'only.ts');
			mkdirSync(directory);
			writeFileSync(file, 'export {};\n');
			symlinkSync(directory, link);
			try {
				expect(resolveInputs([file, link], 'test')).toEqual([
					path.relative(ROOT, file).split(path.sep).join('/')
				]);
			} finally {
				rmSync(link, { force: true });
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);
});

describe('bad input dies at the boundary', () => {
	it('omits parent-owned ANSI when NO_COLOR is set', () => {
		const result = spawnSync('bun', [SCRIPT, '--unknown'], {
			cwd: ROOT,
			encoding: 'utf8',
			env: { ...sanitizedGitEnv(), NO_COLOR: '1' }
		});
		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).not.toContain('\x1b');
	});

	it.each([
		['an empty argument', ['']],
		['a newline-joined list arriving as one argument', ['src/a.ts\nsrc/b.ts']],
		['a path that does not exist', ['src/does-not-exist.ts']],
		['a path outside the repository', ['/etc/hosts']],
		['an unknown flag', ['--CI', '--scope', 'lint']],
		['a misspelled flag whose value would leak into the file list', ['--scop', 'lint']]
	])('rejects %s', (_label, args) => {
		expect(run(...args)).toBe(1);
	});

	// A staged run with a clean index is an honest no-op. Skip this local assertion
	// while a developer has real staged files, since it would run the complete gate.
	const nothingStaged =
		spawnSync('git', ['diff', '--cached', '--quiet'], {
			cwd: ROOT,
			env: sanitizedGitEnv()
		}).status === 0;
	it.skipIf(!nothingStaged)('still accepts a run with nothing staged', () => {
		expect(run('--staged', '--scope', 'lint')).toBe(0);
	});
});

describe('knip integration', () => {
	it('keeps knip out of the file-scoped ledger', () => {
		expect(
			Object.keys(ROUTES),
			'knip is a whole-project check and must not count as file-scoped work'
		).not.toContain('knip');
	});

	// Positions are line-based with `//` and `/* */` comment lines blanked out. A commented-out
	// step still contains its own call text, so a plain source search keeps passing over
	// exactly the edit this pins: measured, commenting the block out left all assertions green.
	// Call anchors match the whole trimmed line, so a call parked behind a trailing comment or a
	// statement on the same line does not count as running.
	// Block membership relies on Prettier's tab indentation, which CI enforces: the lint group
	// opens at one tab and closes at the first bare `\t}` after it, the staged guard at two.
	// The call must also be unique and the last command of the group: a duplicate outside the
	// staged guard would run in the pre-commit path, and a command appended after it would
	// displace knip from the end.
	it('runs knip as the last lint-group step and skips the staged gate', () => {
		const lines = readFileSync(SCRIPT, 'utf8').split('\n');
		let inBlockComment = false;
		const code = lines.map((line) => {
			const trimmed = line.trim();
			if (inBlockComment) {
				if (trimmed.includes('*/')) inBlockComment = false;
				return '';
			}
			if (trimmed.startsWith('/*')) {
				if (!trimmed.includes('*/')) inBlockComment = true;
				return '';
			}
			return trimmed.startsWith('//') ? '' : line;
		});
		const reason = 'knip must run as the last lint-group step so a lint-only CI job covers it';
		const stagedReason = 'knip reads the working tree, so the staged pre-commit gate must skip it';

		const lintGroup = code.findIndex((line) => line === '\tif (shouldRunLint) {');
		const lintGroupEnd = code.findIndex((line, i) => i > lintGroup && line === '\t}');
		const oxlint = code.findIndex((line) => line.trim() === "await runCommand('bun', ['oxlint']);");
		const stagedGuard = code.findIndex(
			(line, i) => i > oxlint && line === "\t\tif (mode !== 'staged') {"
		);
		const stagedGuardEnd = code.findIndex((line, i) => i > stagedGuard && line === '\t\t}');
		const knip = code.findIndex(
			(line) => line.trim() === "await runCommand('bun', ['knip', '--no-progress']);"
		);
		const typesGroup = lines.findIndex((line) => line.includes('// -- Types group'));
		const knipCalls = code.filter(
			(line) => line.trim() === "await runCommand('bun', ['knip', '--no-progress']);"
		).length;
		const trailingCall = code.findIndex(
			(line, i) => i > knip && i < lintGroupEnd && line.trim().startsWith('await runCommand(')
		);

		expect(lintGroup, reason).toBeGreaterThan(-1);
		expect(knip, reason).toBeGreaterThan(oxlint);
		expect(knip, reason).toBeLessThan(lintGroupEnd);
		expect(lintGroupEnd, reason).toBeLessThan(typesGroup);
		expect(stagedGuard, stagedReason).toBeGreaterThan(-1);
		expect(knip, stagedReason).toBeGreaterThan(stagedGuard);
		expect(knip, stagedReason).toBeLessThan(stagedGuardEnd);
		expect(knipCalls, stagedReason).toBe(1);
		expect(trailingCall, reason).toBe(-1);
	});
});
