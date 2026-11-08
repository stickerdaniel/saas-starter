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
import { spawn, spawnSync } from 'child_process';
import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'os';
import path from 'path';
import { Writable } from 'stream';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { readPid } from './__fixtures__/static-checks/pid-file';
import { sanitizedGitEnv } from './git-context';
import { SOURCE_FIXTURE_ROOT } from './source-tree';
import { testExecutable } from './test-executable';
import {
	argumentBatches,
	authoredTextFiles,
	englishProseFindings,
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
	startCommand,
	unsafePathCodepoints,
	SVELTE_KIT_SYNC_WAIT_MESSAGE,
	usesAssertOnlyChecks
} from './static-checks';
import { withSvelteKitSyncLock } from './svelte-kit-sync-lock';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'static-checks.ts');

/**
 * Test budget for a describe block whose tests start the checker in a child Bun.
 * Loading its imports takes about a second idle, and CPU contention multiplies
 * that: in a fork, a case measured at 1.8s idle took 5.6s beside a whole-project
 * check, past Vitest's 5s default. This matches the file-wide budget in
 * `static-checks.format.test.ts`.
 */
const CHECKER_SPAWN_TIMEOUT = 30_000;

const FIXTURES = path.join(ROOT, 'scripts', '__fixtures__', 'static-checks');
const BUN = testExecutable('bun');

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

	it('routes supported prose while excluding ignored reports and artifacts', async () => {
		const foreign = 'Das Passwort muss sofort zurückgesetzt werden.';
		const files = [
			'docs/example.md',
			'references/report.md',
			'scratch/session/report.md',
			'src/i18n/de.json'
		];
		const contents = new Map(files.map((file) => [file, foreign]));
		expect(ROUTES['english-prose'](files[0]!)).toBe(true);
		expect(ROUTES['english-prose'](files[1]!)).toBe(true);
		expect(ROUTES['english-prose'](files[2]!)).toBe(true);
		expect(ROUTES['english-prose'](files[3]!)).toBe(false);
		const findings = await englishProseFindings(files, async (file) => contents.get(file) ?? '');
		expect(findings).toHaveLength(1);
		expect(findings).toMatchObject([{ label: 'docs/example.md', language: 'de' }]);
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
		expect(await prettierFormattableFiles(['src/varlock-env.d.ts', 'scratch/probe.ts'])).toEqual(
			[]
		);
		expect(
			await prettierFormattableFiles([
				'src/routes/+layout.svelte',
				'src/lib/scratch/probe.ts',
				'src/varlock-env.d.ts'
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

	it('excludes only the generated English policy bundle from authored checks', async () => {
		const generatedBundle = 'scripts/english-policy/pr-metadata.bundle.mjs';
		const authoredSource = 'scripts/english-policy/pr-metadata.ts';
		const otherBundle = 'scripts/example.bundle.mjs';

		expect(ROUTES.misspell(generatedBundle)).toBe(false);
		expect(ROUTES['english-prose'](generatedBundle)).toBe(false);
		expect(ROUTES.eslint(generatedBundle)).toBe(false);
		expect(await prettierFormattableFiles([generatedBundle])).toEqual([]);
		expect(spellcheckFiles([generatedBundle, authoredSource, otherBundle])).toEqual([
			authoredSource,
			otherBundle
		]);
		expect(ROUTES['english-prose'](otherBundle)).toBe(true);
		expect(ROUTES.eslint(otherBundle)).toBe(true);
	});

	it.each(['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'svelte'])(
		'routes .%s source files through prose and source checks',
		(extension) => {
			const file = `scripts/example.${extension}`;
			expect(ROUTES['english-prose'](file)).toBe(true);
			expect(ROUTES.eslint(file)).toBe(true);
		}
	);

	it('routes the creator package and shared Windows helper through its dedicated project', () => {
		for (const file of [
			'packages/create-saas-starter/src/index.ts',
			'packages/create-saas-starter/test/options.test.ts',
			'packages/create-saas-starter/scripts/build.ts',
			'packages/create-saas-starter/tsconfig.json',
			'packages/create-saas-starter/package.json',
			'packages/create-saas-starter/bun.lock',
			'scripts/windows-job.ts'
		]) {
			expect(ROUTES['cli-types'](file), file).toBe(true);
		}
		expect(ROUTES['svelte-check']('packages/create-saas-starter/src/index.ts')).toBe(false);
		expect(ROUTES['cli-types']('packages/create-saas-starter/README.md')).toBe(false);
		expect(ROUTES['cli-types']('scripts/static-checks.ts')).toBe(false);
	});

	it('routes every skill script through the shared skills project', () => {
		expect(
			ROUTES['skill-types']('.agents/skills/upstream-report/scripts/upstream-relevance.ts')
		).toBe(true);
		expect(ROUTES['skill-types']('.agents/skills/upstream-sync/scripts/find-fork-point.ts')).toBe(
			true
		);
		expect(ROUTES['skill-types']('.agents/skills/tsconfig.json')).toBe(true);
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

describe('repository path safety', { timeout: CHECKER_SPAWN_TIMEOUT }, () => {
	it('keeps missing tracked files out of full-mode content readers', () => {
		expect(existingRepositoryPaths(['README.md', 'docs/does-not-exist.md'])).toEqual(['README.md']);
	});

	it('counts formattable files and drops an ignored declaration', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'static-checks-format-count-'));
		try {
			mkdirSync(path.join(directory, 'src'), { recursive: true });
			mkdirSync(path.join(directory, 'node_modules'), { recursive: true });
			writeFileSync(path.join(directory, '.prettierignore'), 'src/varlock-env.d.ts\n');
			writeFileSync(path.join(directory, 'src/kept.ts'), 'export const value = 1;\n');
			writeFileSync(path.join(directory, 'src/varlock-env.d.ts'), 'export {};\n');
			writeFileSync(path.join(directory, 'node_modules/ignored.ts'), 'export const hidden = 1;\n');

			const traversed = prettierTraversalPaths(directory, false, directory);
			const formattable = await prettierFormattableFiles(
				prettierProjectPaths(traversed, directory),
				directory
			);

			expect(formattable).toContain('src/kept.ts');
			expect(formattable).not.toContain('src/varlock-env.d.ts');
			expect(traversed).toContain('src/varlock-env.d.ts');
			expect(traversed.join('\n')).not.toContain('node_modules/');
			expect(formattable.length).toBeGreaterThan(0);
			expect(formattable.length).toBeLessThan(traversed.length);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
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
		}
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

	// The dot directory builds inside SOURCE_FIXTURE_ROOT, the one directory every recursive
	// walk of `src/` skips by name. Directly under `src/` it appeared and vanished in the
	// path of those walks, and a walk that listed it before this case removed it died on
	// `ENOENT scandir` while this case still passed. The fixture root is itself a `src/`
	// descendant, so the dot directory is still reached through the directory argument below.
	it('includes dot-directory descendants of a directory argument', () => {
		const directory = path.join(SOURCE_FIXTURE_ROOT, '.static-checks-directory-test');
		const file = path.join(directory, 'instructions.md');
		mkdirSync(directory, { recursive: true });
		writeFileSync(file, 'safe');
		try {
			expect(resolveInputs([path.join(ROOT, 'src')], 'test')).toContain(
				path.relative(ROOT, file).split(path.sep).join('/')
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

describe('bad input dies at the boundary', { timeout: CHECKER_SPAWN_TIMEOUT }, () => {
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
});

describe('SvelteKit sync', () => {
	// Every sync deletes and rewrites the root route's types, so a second sync of the same
	// checkout listing them at that moment fails with ENOENT. Concurrent runs take turns.
	it('waits while another process syncs this checkout', async () => {
		let output = '';
		let exited: Promise<number | null> | undefined;

		await withSvelteKitSyncLock(ROOT, async () => {
			const child = spawn('bun', [SCRIPT, '--scope', 'lint', 'scripts/svelte-kit-sync-lock.ts'], {
				cwd: ROOT,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1' }
			});
			child.stdout.on('data', (chunk) => (output += chunk));
			child.stderr.on('data', (chunk) => (output += chunk));
			exited = new Promise((resolve) => child.on('close', resolve));

			const deadline = Date.now() + 60_000;
			while (!output.includes(SVELTE_KIT_SYNC_WAIT_MESSAGE)) {
				expect(Date.now(), `the run never waited for the held lock:\n${output}`).toBeLessThan(
					deadline
				);
				expect(child.exitCode, output).toBeNull();
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		});

		expect(await exited, output).toBe(0);
	}, 240_000);
});

describe('commands started before their step', { timeout: CHECKER_SPAWN_TIMEOUT }, () => {
	const DRIVER = path.join(FIXTURES, 'started-command.ts');

	/** Runs a driver case with stdout and stderr written to one file, in write order. */
	function drive(
		scenario: string,
		githubActions = false,
		env: Record<string, string> = {}
	): { status: number; output: string } {
		const directory = mkdtempSync(path.join(tmpdir(), 'started-command-'));
		const outputPath = path.join(directory, 'output');
		const output = openSync(outputPath, 'w');
		try {
			const result = spawnSync(BUN, [DRIVER, scenario, directory], {
				cwd: ROOT,
				env: {
					...sanitizedGitEnv(),
					NO_COLOR: '1',
					GITHUB_ACTIONS: String(githubActions),
					...env
				},
				stdio: ['ignore', output, output],
				timeout: 20_000
			});
			return { status: result.status ?? -1, output: readFileSync(outputPath, 'utf8') };
		} finally {
			closeSync(output);
			rmSync(directory, { recursive: true, force: true });
		}
	}

	it('holds both streams until finish and keeps each stream in order', () => {
		const { status, output } = drive('interleaved');
		const lines = output.trim().split('\n');

		expect(lines[0]).toBe('before-finish');
		expect(lines.at(-1)).toBe('after-finish');
		expect(lines.filter((line) => line.startsWith('out-'))).toEqual(['out-1', 'out-2']);
		expect(lines.toSorted()).toEqual(['after-finish', 'before-finish', 'err-1', 'out-1', 'out-2']);
		expect(status).toBe(0);
	});

	it('shows what a still-running command printed as soon as its step starts', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'started-command-'));
		try {
			const child = spawn(BUN, [DRIVER, 'gated', directory], {
				cwd: ROOT,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1', GITHUB_ACTIONS: 'false' },
				stdio: ['ignore', 'pipe', 'inherit']
			});
			let output = '';
			child.stdout.on('data', (chunk: Buffer) => {
				output += chunk.toString();
				// The command waits for this file, so it can only finish once its prefix is out.
				if (output.includes('prefix\n')) writeFileSync(path.join(directory, 'gate'), '');
			});
			const status = await new Promise<number | null>((resolve) => child.on('close', resolve));

			expect(output).toBe('finishing\nprefix\nsuffix\nfinished\n');
			expect(status).toBe(0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.each([
		['fails', 'failure', 3, 'diagnostic\nCommand failed: '],
		['cannot start', 'missing', 1, 'Command could not start: missing-static-checks-command\n']
	])(
		'reports a command that %s at finish, the way a sequential run does',
		(_label, scenario, status, report) => {
			const started = drive(`started-${scenario}`);

			expect(started.output).toContain(`before-finish\n${report}`);
			expect(started.status).toBe(status);
			expect(started).toEqual(drive(`run-${scenario}`));
		}
	);

	async function waitFor(ready: () => boolean): Promise<void> {
		const deadline = Date.now() + 10_000;
		while (!ready()) {
			if (Date.now() > deadline) throw new Error('Timed out');
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	it('finishes only after the destination accepted the held output', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'started-command-'));
		const exited = path.join(directory, 'exited');
		const callbacks: Array<() => void> = [];
		let accepting = false;
		let text = '';
		const destination = new Writable({
			write(chunk: Buffer, _encoding, callback) {
				text += chunk.toString();
				if (accepting) callback();
				else callbacks.push(callback);
			}
		});
		try {
			const command = startCommand(
				process.execPath,
				[
					'-e',
					"process.stdout.write('output\\n'); require('fs').writeFileSync(process.argv[1], '')",
					exited
				],
				{ stdout: destination, stderr: destination, githubActions: false }
			);
			await waitFor(() => existsSync(exited));
			const finished = command.finish().then(() => 'finished');
			const early = await Promise.race([
				finished,
				new Promise((resolve) => setTimeout(() => resolve('waiting'), 500))
			]);
			accepting = true;
			for (const callback of callbacks) callback();

			expect(early).toBe('waiting');
			expect(await finished).toBe('finished');
			expect(text).toBe('output\n');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('keeps output that arrives while held output is written, then passes output through', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'started-command-'));
		const marker = (name: string) => path.join(directory, name);
		// Each line waits for the test's marker file before it is written.
		const script = `
			const { existsSync, writeFileSync } = require('fs');
			const directory = process.argv[1];
			const after = (name, next) => {
				const deadline = Date.now() + 10000;
				const timer = setInterval(() => {
					if (existsSync(directory + '/' + name)) {
						clearInterval(timer);
						next();
					} else if (Date.now() > deadline) process.exit(9);
				}, 10);
			};
			process.stdout.write('prefix\\n');
			writeFileSync(directory + '/printed', '');
			after('intervene', () => {
				process.stdout.write('intervening\\n');
				writeFileSync(directory + '/intervened', '');
				after('live', () => process.stdout.write('suffix\\n'));
			});
		`;
		let acceptFirst = (): void => {};
		const firstAccepted = new Promise<void>((resolve) => (acceptFirst = resolve));
		const chunks: string[] = [];
		const destination = new Writable({
			write(chunk: Buffer, _encoding, callback) {
				chunks.push(chunk.toString());
				if (chunks.length === 1) void firstAccepted.then(() => callback());
				else callback();
			}
		});
		try {
			const command = startCommand(process.execPath, ['-e', script, directory], {
				stdout: destination,
				stderr: destination,
				githubActions: true
			});
			await waitFor(() => existsSync(marker('printed')));
			const finished = command.finish();
			// The stop marker is now written but unaccepted. The next line arrives meanwhile; the
			// pause lets it reach the held queue, though the order holds either way.
			writeFileSync(marker('intervene'), '');
			await waitFor(() => existsSync(marker('intervened')));
			await new Promise((resolve) => setTimeout(resolve, 100));
			acceptFirst();
			await waitFor(() => chunks.join('').includes('intervening\n'));
			writeFileSync(marker('live'), '');
			await finished;

			const token = chunks.join('').match(/^::stop-commands::(.+)$/m)?.[1];
			expect(chunks.join('')).toBe(
				`\n::stop-commands::${token}\nprefix\nintervening\nsuffix\n\n::${token}::\n`
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('replays the GitHub workflow-command markers once, around the output', () => {
		const { status, output } = drive('started-failure', true);
		const token = output.match(/^::stop-commands::(.+)$/m)?.[1];

		expect(token).toBeDefined();
		expect(output.split(`::stop-commands::${token}`)).toHaveLength(2);
		expect(output.split(`::${token}::`)).toHaveLength(2);
		expect(output.indexOf('before-finish')).toBeLessThan(output.indexOf('::stop-commands::'));
		expect(output.indexOf('diagnostic')).toBeGreaterThan(output.indexOf('::stop-commands::'));
		expect(output.indexOf(`::${token}::`)).toBeGreaterThan(output.indexOf('diagnostic'));
		expect(status).toBe(3);
	});

	it.each([
		['SOURCE-1', false],
		['SOURCE-1', true],
		['::stop-commands::', true]
	])(
		'handles a destination that refuses %s like an unheld run (GitHub Actions: %s)',
		(refuse, githubActions) => {
			const normalize = (output: string) =>
				output.replaceAll(/terminal-output-[0-9a-f-]+/g, 'TOKEN');
			const started = drive('destination-error-started', githubActions, { REFUSE: refuse });
			const run = drive('destination-error-run', githubActions, { REFUSE: refuse });

			expect(normalize(started.output)).toBe(normalize(run.output));
			expect(started.output.includes('OTHER-SOURCE')).toBe(refuse === 'SOURCE-1');
			expect(started.output).not.toContain('SOURCE-2');
			expect(started.status).toBe(1);
			expect(run.status).toBe(1);
		}
	);

	it('takes a PID file as ready only once it holds a positive PID', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'pid-file-'));
		try {
			const file = path.join(directory, 'pid');
			const states = ['', '0\n', '42'].map((text) => {
				writeFileSync(file, text);
				return readPid(file);
			});
			writeFileSync(file, '4242\n');

			expect(readPid(path.join(directory, 'missing'))).toBeUndefined();
			expect(states).toEqual([undefined, undefined, undefined]);
			expect(readPid(file)).toBe(4242);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	/** Alive and not a zombie that its new parent has yet to reap. */
	function running(pid: number): boolean {
		const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
		return state.stdout.trim() !== '' && !state.stdout.trim().startsWith('Z');
	}

	it.skipIf(process.platform === 'win32')(
		'kills every descendant of a started command when an earlier check exits',
		async () => {
			const directory = mkdtempSync(path.join(tmpdir(), 'started-command-'));
			const pids: number[] = [];
			try {
				const result = spawnSync(BUN, [DRIVER, 'early-exit', directory], {
					cwd: ROOT,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1', GITHUB_ACTIONS: 'false' },
					encoding: 'utf8',
					timeout: 20_000
				});
				expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
				// One grandchild ignores SIGTERM beside its live leader; the other outlived its leader.
				for (const name of ['stubborn', 'orphaned']) {
					// Never a malformed one: `Number('')` is 0, and SIGKILL to 0 hits this process group.
					const pid = readPid(path.join(directory, name));
					if (pid === undefined) throw new Error(`The driver exited before ${name} held a PID`);
					pids.push(pid);
				}
				const deadline = Date.now() + 5_000;
				while (pids.some(running) && Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 20));
				}

				expect(pids.filter(running)).toEqual([]);
			} finally {
				for (const pid of pids) {
					try {
						process.kill(pid, 'SIGKILL');
					} catch {
						// Already gone.
					}
				}
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);
});

describe('English prose workers', { timeout: CHECKER_SPAWN_TIMEOUT }, () => {
	const DRIVER = path.join(FIXTURES, 'prose-workers.ts');
	const GERMAN = 'Das Passwort muss sofort zurückgesetzt werden.\n';

	interface Report {
		labels?: string[];
		error?: string;
	}

	/** What the two-worker pool and the inline check report for the same files. */
	function compare(
		entry: string,
		contents: string[]
	): { workers: Report; inline: Report; files: string[] } {
		const directory = mkdtempSync(path.join(tmpdir(), 'prose-workers-'));
		try {
			const files = contents.map((content, index) => {
				const file = path.join(directory, `${index}.${content.startsWith('{') ? 'json' : 'md'}`);
				writeFileSync(file, content);
				return file;
			});
			const result = spawnSync(BUN, [DRIVER, entry, ...files], {
				cwd: ROOT,
				env: { ...sanitizedGitEnv(), PROSE_WORKER_GATE: path.join(directory, 'gate') },
				encoding: 'utf8',
				timeout: 20_000
			});
			expect(result.status, result.stderr).toBe(0);
			return { ...(JSON.parse(result.stdout) as { workers: Report; inline: Report }), files };
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}

	it('reports findings in file order when a later shard finishes first', () => {
		// Shards [0, 2] and [1]; the fixture worker for [0, 2] posts only after [1] has.
		const { workers, inline, files } = compare(path.join(FIXTURES, 'prose-worker-gated.ts'), [
			GERMAN,
			GERMAN,
			GERMAN
		]);

		expect(workers).toMatchObject({ labels: files });
		expect(workers).toEqual(inline);
	});

	it('withholds an earlier finding behind a later unreadable file, as the inline check does', () => {
		const { workers, inline, files } = compare('default', [GERMAN, '{"description": ']);

		expect(workers).toEqual({ error: `Cannot parse ${files[1]} as JSON/JSONC.` });
		expect(workers).toEqual(inline);
	});

	it('keeps a received file error when another worker fails, without reading the file again', () => {
		const { workers, inline, files } = compare(
			path.join(FIXTURES, 'prose-worker-fails-after-error.ts'),
			[GERMAN, GERMAN]
		);

		expect(workers).toEqual({ error: 'Transient read failure for the first prose file' });
		expect(inline).toMatchObject({ labels: files });
	});

	it('falls back to the inline check when a worker closes without a result', () => {
		const { workers, inline, files } = compare(path.join(FIXTURES, 'prose-worker-closes.ts'), [
			GERMAN,
			GERMAN
		]);

		expect(workers).toMatchObject({ labels: files });
		expect(workers).toEqual(inline);
	});
});
