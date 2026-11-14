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
 *   2. Bad input dies at the boundary. Every case under that title in
 *      `static-checks.processes.test.ts` exits before a check runs, so those stay fast.
 */
import { spawn, spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import {
	CHECKER_SPAWN_TIMEOUT,
	checkoutEvaluator
} from './__fixtures__/static-checks/checker-harness';
import { usePrivateCheckout } from './__fixtures__/static-checks/private-checkout';
import { sanitizedGitEnv } from './git-context';
import { testExecutable } from './test-executable';
import {
	argumentBatches,
	authoredTextFiles,
	englishProseFindings,
	isIgnoredPath,
	literalControlCharacterViolations,
	prettierArguments,
	prettierFormattableFiles,
	ROUTES,
	middleDotOrEmDashLines,
	resolveInputs,
	spellcheckFiles,
	SVELTE_KIT_SYNC_WAIT_MESSAGE,
	usesAssertOnlyChecks
} from './static-checks';
import { withSvelteKitSyncLock } from './svelte-kit-sync-lock';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'static-checks.ts');

const FIXTURES = path.join(ROOT, 'scripts', '__fixtures__', 'static-checks');
const BUN = testExecutable('bun');

/** Cases that write fixtures share this private checkout and remove what they write. */
const checkout = usePrivateCheckout('static-checks-');
const evaluateInCheckout = checkoutEvaluator(checkout);

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

	it('routes shipped locale, content and static text through the banned-pattern scan', () => {
		expect(ROUTES['banned-patterns']('src/i18n/fr.json')).toBe(true);
		expect(ROUTES['banned-patterns']('src/lib/content/legal/privacy.md')).toBe(true);
		expect(ROUTES['banned-patterns']('src/lib/content/llms.txt')).toBe(true);
		expect(ROUTES['banned-patterns']('src/lib/convex/support/instructions.txt')).toBe(true);
		expect(ROUTES['banned-patterns']('src/app.html')).toBe(true);
		expect(ROUTES['banned-patterns']('src/lib/components/desk-computer/desk-computer.svg')).toBe(
			true
		);
		expect(ROUTES['banned-patterns']('static/manifest.webmanifest')).toBe(true);
		expect(ROUTES['banned-patterns']('static/logo.svg')).toBe(true);
		expect(ROUTES['banned-patterns']('src/lib/convex/tsconfig.json')).toBe(false);
		expect(ROUTES['banned-patterns']('src/lib/convex/AGENTS.md')).toBe(false);
		expect(ROUTES['banned-patterns']('static/og-image.png')).toBe(false);
	});

	// JSON.parse and the browser decode an escape or a character reference into the
	// banned character. The characters are built from their code points, so this file
	// stays free of the text the scan bans.
	it.each([
		['the character', `"title": "Pro ${String.fromCharCode(0x00b7)} monthly"`],
		['a JSON escape', '"title": "Pro \\u2014 monthly"'],
		['an escape after an escaped backslash', '"title": "C:\\\\\\u00B7"'],
		['a named reference', 'Pro &middot; monthly'],
		['the legacy reference without semicolon', 'Pro &middot monthly'],
		['a decimal reference', 'Pro &#8212; monthly'],
		['a decimal reference without semicolon', 'Pro &#8212 monthly'],
		['a hex reference', 'Pro &#xB7; monthly']
	])('flags a middle dot or em dash written as %s in shipped text', (_label, line) => {
		expect(middleDotOrEmDashLines('src/i18n/en.json', line)).toEqual([1]);
	});

	it.each([
		['an en dash', `Pro ${String.fromCharCode(0x2013)} monthly - &ndash; &#8211;`],
		['a literal backslash before u2014', '"label": "escape \\\\u2014"'],
		['a misspelled named reference', 'Pro &MDASH; monthly'],
		['a reference the parser leaves literal', 'Pro &mdash monthly'],
		['another code point with the same prefix', 'Pro &#1830; &#x2014a; monthly']
	])('passes %s in shipped text', (_label, line) => {
		expect(middleDotOrEmDashLines('src/i18n/en.json', line)).toEqual([]);
	});

	it('skips comments, scripts and styles in HTML and reports rendered lines', () => {
		const dash = String.fromCharCode(0x2014);
		const html = [
			`<!-- license ${dash}`,
			`notice ${dash} -->`,
			`<script>`,
			`// recovery ${dash} reload`,
			`</script>`,
			`<style>p::after { content: '${dash}'; }</style>`,
			`<meta content="Pro ${dash} monthly" />`
		].join('\n');
		expect(middleDotOrEmDashLines('src/app.html', html)).toEqual([7]);
		expect(middleDotOrEmDashLines('src/i18n/en.json', `"a": "<!-- ${dash} -->"`)).toEqual([1]);
		expect(
			middleDotOrEmDashLines('src/lib/content/legal/privacy.md', `Use \`<script>${dash}</script>\``)
		).toEqual([1]);
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
		const file = path.join(checkout().repository, `..resolve-dots-${process.pid}.ts`);
		writeFileSync(file, 'export const valid = true;\n');
		try {
			expect(evaluateInCheckout("checks.resolveInputs([values[0]], 'test')", [file])).toEqual([
				path.basename(file)
			]);
		} finally {
			rmSync(file, { force: true });
		}
	});

	it('includes dot-directory descendants of a directory argument', () => {
		const { repository } = checkout();
		const directory = path.join(repository, 'src', '.static-checks-directory-test');
		const file = path.join(directory, 'instructions.md');
		mkdirSync(directory, { recursive: true });
		writeFileSync(file, 'safe');
		try {
			const source = path.join(repository, 'src');
			expect(evaluateInCheckout("checks.resolveInputs([values[0]], 'test')", [source])).toContain(
				'src/.static-checks-directory-test/instructions.md'
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === 'win32')(
		'accepts a directory whose files were already named',
		() => {
			const { repository } = checkout();
			const name = `.static-checks-overlap-target-${process.pid}`;
			const directory = path.join(repository, name);
			const link = path.join(repository, `.static-checks-overlap-link-${process.pid}`);
			const file = path.join(directory, 'only.ts');
			mkdirSync(directory);
			writeFileSync(file, 'export {};\n');
			symlinkSync(directory, link);
			try {
				expect(evaluateInCheckout("checks.resolveInputs(values, 'test')", [file, link])).toEqual([
					`${name}/only.ts`
				]);
			} finally {
				rmSync(link, { force: true });
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);
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
	//
	// A type-scoped run over a locale file syncs and then switches every covering check off.
	// A lint run would end in oxlint and knip over the whole checkout and fail on any file
	// this case never named.
	it('waits while another process syncs this checkout', async () => {
		let output = '';
		let exited: Promise<number | null> | undefined;

		await withSvelteKitSyncLock(ROOT, async () => {
			const child = spawn('bun', [SCRIPT, '--scope', 'types', 'src/i18n/en.json'], {
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
