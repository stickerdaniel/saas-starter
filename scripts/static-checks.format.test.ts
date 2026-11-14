import { spawnSync } from 'child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { stripVTControlCharacters } from 'util';
import { describe, expect, it, vi } from 'vitest';
import { formatChecks, repositoryFileWriter } from './__fixtures__/static-checks/format-harness';
import { usePrivateCheckout } from './__fixtures__/static-checks/private-checkout';
import { sanitizedGitEnv } from './git-context';
import {
	isNeverWalked,
	prettierArguments,
	prettierLiteralPattern,
	prettierTraversalPaths,
	resolveInputs
} from './static-checks';
import { testExecutable } from './test-executable';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'static-checks.ts');

// Most tests here block on real Bun and Prettier processes, so Vitest checks the budget only
// after spawnSync returns; the helpers' 10 s child timeout is the hang guard. The slowest test
// without its own budget took 5.2 s on a GitHub-hosted runner and 4.4 s on Ubicloud
// (observed 2026-10-15), so the 5 s default failed a run whose assertions all passed.
vi.setConfig({ testTimeout: 30_000 });

/** Read-only cases check the shared checkout; nothing they run writes into it. */
const { formatCheck, formatCheckFilesFrom } = formatChecks();

/** Cases that write fixtures share this private checkout and remove what they write. */
const checkout = usePrivateCheckout('static-checks-format-');
const withRepositoryFile = repositoryFileWriter(checkout);

describe('format-only static checks', () => {
	it('routes a real Prettier parse error through the terminal boundary', () => {
		const relative = `scripts/.format-control-${process.pid}.ts`;
		const escape = String.fromCharCode(0x1b);
		withRepositoryFile(relative, `export const value = ${escape}[31m;\n`, (file) => {
			const { status, output } = formatChecks(checkout().repository).formatCheck(file);
			expect(status).not.toBe(0);
			expect(output).toContain('U+001B');
			expect(output).not.toContain(escape);
			expect(output).not.toContain('SvelteKit sync');
			expect(output).not.toContain('ESLint');
		});
	});

	// Prettier reads a leading-dash path as an option, warns that the option is unknown,
	// finds no file left to check and exits 0. Both hand-offs therefore pass the paths
	// after "--": the checker's own CLI, and the Prettier invocation behind it.
	it.each(['0', '1'])('checks a file whose name begins with dashes (FORCE_COLOR=%s)', (color) => {
		const directory = mkdtempSync(path.join(tmpdir(), 'static-checks-dash-'));
		const env = { ...sanitizedGitEnv(), FORCE_COLOR: color, NO_COLOR: undefined };
		const name = `--format-dash-${process.pid}.ts`;
		const prettierBin = path.join(ROOT, 'node_modules/prettier/bin/prettier.cjs');
		try {
			writeFileSync(path.join(directory, name), 'export const value    =    1;\n');
			const args = prettierArguments('--check', [name]);
			expect(args.indexOf('--')).toBe(args.length - 2);
			expect(args.at(-1)).toBe(name);

			const checked = spawnSync(process.execPath, [prettierBin, ...args.slice(1)], {
				cwd: directory,
				env,
				encoding: 'utf8',
				timeout: 10_000
			});
			const output = stripVTControlCharacters(`${checked.stdout}${checked.stderr}`);
			expect(checked.status).toBe(1);
			expect(output).toContain(`[warn] ${name}`);

			// Without the separator Prettier reads the name as an option and checks nothing.
			const ignored = spawnSync(
				process.execPath,
				[prettierBin, '--check', '--ignore-unknown', name],
				{ cwd: directory, env, encoding: 'utf8', timeout: 10_000 }
			);
			const ignoredOutput = stripVTControlCharacters(`${ignored.stdout}${ignored.stderr}`);
			expect(ignored.status).toBe(0);
			expect(ignoredOutput).not.toContain(`[warn] ${name}`);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('keeps a filename whose name begins with a space distinct from its neighbour', () => {
		const { repository } = checkout();
		const { formatCheckFilesFrom } = formatChecks(repository);
		const plain = `.format-space-${process.pid}.ts`;
		const spaced = ` ${plain}`;
		writeFileSync(path.join(repository, spaced), 'export const value    =    1;\n');
		writeFileSync(path.join(repository, plain), 'export const value = 1;\n');
		try {
			// Trimming rewrote the spaced path into the formatted neighbour and let the
			// unformatted file pass unseen.
			const alone = formatCheckFilesFrom(`${spaced}\0`);
			expect(alone.status).not.toBe(0);
			expect(alone.output).toContain(`[warn] ${spaced}`);
			expect(alone.output).not.toContain(`[warn] ${plain}`);

			const plainRecord = formatCheckFilesFrom(`${plain}\0`);
			expect(plainRecord.status).toBe(0);
			expect(plainRecord.output).toContain('prettier         1 file(s)');

			const finalCr = formatCheckFilesFrom(`${plain}\r\0`);
			expect(finalCr.status).toBe(1);
			expect(finalCr.output).toContain('Unsafe U+000D');
		} finally {
			rmSync(path.join(repository, spaced), { force: true });
			rmSync(path.join(repository, plain), { force: true });
		}
	}, 60_000);

	it.skipIf(process.platform === 'win32')('accepts a path made entirely of spaces', () => {
		withRepositoryFile(' ', 'plain text\n', (file) => {
			const result = formatChecks(checkout().repository).formatCheckFilesFrom(' \0');
			expect(result.status).toBe(0);
			expect(result.output).toContain('No formatter work');
			expect(result.output).not.toContain('Empty path');
			expect(file).toBe(path.join(checkout().repository, ' '));
		});
	});

	it('rejects an ambiguous BOM whether it starts the stream or a later path', () => {
		const { repository } = checkout();
		const checker = formatChecks(repository);
		const plain = `.format-bom-${process.pid}.ts`;
		const marked = `${String.fromCharCode(0xfeff)}${plain}`;
		try {
			writeFileSync(path.join(repository, plain), 'export const value = 1;\n');
			const first = checker.formatCheckFilesFrom(`${marked}\0${plain}\0`);
			expect(first.status).toBe(1);
			expect(first.output).toContain('without a byte-order mark');

			writeFileSync(path.join(repository, marked), 'export const value = 1;\n');
			const later = checker.formatCheckFilesFrom(`${plain}\0${marked}\0`);
			expect(later.status).toBe(1);
			expect(later.output).toContain('Unsafe U+FEFF');
		} finally {
			rmSync(path.join(repository, plain), { force: true });
			rmSync(path.join(repository, marked), { force: true });
		}
	});

	it('rejects file lists that are not valid UTF-8', () => {
		const result = formatCheckFilesFrom(Uint8Array.from([0xc3, 0x28]));
		expect(result.status).toBe(1);
		expect(result.output).toContain('bytes that are not valid UTF-8');
		expect(result.output).not.toContain('SvelteKit sync');
	});

	it('rejects nonempty computed lists containing an empty path record', () => {
		for (const input of ['\0', 'README.md\0\0']) {
			const result = formatCheckFilesFrom(input);
			expect(result.status).toBe(1);
			expect(result.output).toContain('empty path record');
		}
	});

	it('resolves computed Git records from the repository root', () => {
		const result = formatCheckFilesFrom('README.md\0', path.join(ROOT, 'scripts'));
		expect(result.status).toBe(0);
		expect(result.output).toContain('prettier         1 file(s)');
		expect(result.output).not.toContain('No such file');
	});

	// Prettier lowercases a basename before comparing plugin extensions. The fallback here
	// exists because classification deliberately does not load the Svelte plugin, so it has
	// to make the same comparison: a case-sensitive `.svelte` test classified this file as
	// unformattable and a mixed computed list exited 0 after checking only its Markdown peer.
	it('checks a mixed-case Svelte extension the configured plugin formats', () => {
		const relative = `scripts/.format-component-${process.pid}.SVELTE`;
		withRepositoryFile(relative, '<script>const value=1</script>\n', () => {
			const { repository } = checkout();
			const { formatCheck, formatCheckFilesFrom } = formatChecks(repository);
			const direct = spawnSync(testExecutable('bun'), ['prettier', '--check', '--', relative], {
				cwd: repository,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
				timeout: 10_000,
				killSignal: 'SIGKILL',
				encoding: 'utf8'
			});
			expect(direct.status, `${direct.stdout}${direct.stderr}`).toBe(1);

			const named = formatCheck(relative);
			expect(named.status, named.output).toBe(1);
			expect(named.output).toContain(relative);

			const computed = formatCheckFilesFrom(`${relative}\0README.md\0`);
			expect(computed.status, computed.output).toBe(1);
			expect(computed.output).toContain(relative);
			expect(computed.output).toContain(`README.md ${relative}`);
		});
	}, 40_000);

	it('escapes a route without a backslash and still checks the named file', () => {
		const route = 'src/routes/[[lang]]/(marketing)/+page.svelte';
		const pattern = prettierLiteralPattern(route);

		// Prettier hands an argument it cannot resolve to normalizeToPosix, which on Windows
		// replaces every backslash with a slash. A backslash-escaped route would arrive there
		// with its escapes stripped and match nothing, so the escape has to be a character
		// class, and the pattern has to survive that same rewrite unchanged.
		expect(pattern).toBe('src/routes/[[][[]lang@(])@(])/[(]marketing[)]/[+]page.svelte');
		expect(pattern.replaceAll('\\', '/')).toBe(pattern);

		const result = formatCheck(route);
		expect(result.status, result.output).toBe(0);
		expect(result.output).toContain('prettier         1 file(s)');
	});

	// A backslash is a path separator on Windows and cannot appear in a filename there, so
	// the fixture itself is unbuildable rather than the assertion being wrong.
	it.skipIf(process.platform === 'win32')(
		'keeps a literal backslash from matching the neighbour without one',
		() => {
			const { repository } = checkout();
			const directory = path.join(repository, 'scripts', `.format-backslash-${process.pid}`);
			const relative = `scripts/.format-backslash-${process.pid}`;
			mkdirSync(directory, { recursive: true });
			try {
				// Only one of the two is malformed. A pattern that drops the backslash checks the
				// other file and reports a formatted repository while the named one stays broken.
				writeFileSync(path.join(directory, 'a\\[b].ts'), 'export const a   =1\n');
				writeFileSync(path.join(directory, 'a[b].ts'), 'export const b = 1;\n');

				const result = formatChecks(repository).formatCheck(`${relative}/a\\[b].ts`);
				expect(result.status, result.output).toBe(1);
				expect(result.output).toContain('a\\[b].ts');
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);

	it('escapes a leading exclamation mark into a pattern Prettier cannot negate', () => {
		expect(prettierLiteralPattern('!a[b].ts')).toBe('@(!)a[[]b@(]).ts');

		const { repository } = checkout();
		withRepositoryFile('!a[b].ts', 'export const a   =1\n', () => {
			const named = formatChecks(repository).formatCheck('!a[b].ts');
			expect(named.status, named.output).toBe(1);
			expect(named.output).toContain('!a[b].ts');
		});

		// The file is gone again here, which is the case a negation turns into a silent pass:
		// measured with Prettier 3.9.5, `./!a[[]b@(]).ts` matched every other root file and
		// exited 0 instead of reporting the path it was given.
		const vanished = spawnSync(
			testExecutable('bun'),
			['prettier', '--check', '--ignore-unknown', '--', prettierLiteralPattern('!a[b].ts')],
			{ cwd: repository, env: { ...sanitizedGitEnv(), NO_COLOR: '1' }, encoding: 'utf8' }
		);
		expect(vanished.status).toBe(2);
		expect(`${vanished.stdout}${vanished.stderr}`).toContain('No files matching the pattern');
	});

	// A Windows checkout with core.symlinks=false materializes the tracked link as an
	// ordinary file holding its target's path, and there is nothing to expand there.
	it.skipIf(!lstatSync(path.join(ROOT, '.claude/skills/upstream-sync')).isSymbolicLink())(
		'expands a symlinked directory for every scope except format',
		() => {
			const link = '.claude/skills/upstream-sync';
			const expanded = resolveInputs([link], 'arguments', ROOT);
			expect(expanded.length).toBeGreaterThan(1);
			expect(expanded.some((file) => file.endsWith('.ts'))).toBe(true);

			// Prettier refuses an explicitly named symlink, so the formatter passes the link
			// itself and lets that refusal happen instead of silently checking the target.
			expect(
				resolveInputs(
					[link],
					'arguments',
					ROOT,
					(directory) => prettierTraversalPaths(directory, false, ROOT),
					false
				)
			).toEqual([link]);
		}
	);

	it('refuses two paths that collide under formatter escaping', () => {
		const { repository } = checkout();
		const directory = path.join(repository, 'scripts', `.format-collide-${process.pid}`);
		const relative = `scripts/.format-collide-${process.pid}`;
		mkdirSync(directory, { recursive: true });
		try {
			writeFileSync(path.join(directory, '[ab].ts'), 'export const a   =1\n');
			writeFileSync(path.join(directory, '[[]ab@(]).ts'), 'export const b = 1;\n');

			const result = formatChecks(repository).formatCheck(`${relative}/[ab].ts`);
			expect(result.status, result.output).toBe(1);
			expect(result.output).toContain('collide under formatter escaping');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	// fast-glob runs micromatch.braces() over the whole pattern before picomatch parses it,
	// and that pass has no notion of character classes: the POSIX form `[]]` next to `[{]` or
	// `[}]` is read as a brace expression, so the pattern stops naming the file it was built
	// from. Measured with Prettier 3.9.5, `[]][{][}].ts` reported the neighbouring `{}.ts`
	// clean while the named file stayed malformed, and the other two matched nothing at all.
	it.each([']{}.ts', '{]}.ts', '{}].ts'])(
		'keeps brace escapes from swallowing a literal bracket in %s',
		(name) => {
			const { repository } = checkout();
			const directory = path.join(repository, 'scripts', `.format-brace-${process.pid}`);
			const relative = `scripts/.format-brace-${process.pid}`;
			mkdirSync(directory, { recursive: true });
			try {
				// Only the named file is malformed. A pattern that expands into a brace expression
				// either checks the neighbour and passes, or matches nothing and passes.
				writeFileSync(path.join(directory, name), 'export const a   =1\n');
				writeFileSync(path.join(directory, '{}.ts'), 'export const b = 1;\n');

				const result = formatChecks(repository).formatCheck(`${relative}/${name}`);
				expect(result.status, result.output).toBe(1);
				expect(result.output).toContain(name);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);

	it('escapes a plus so it cannot quantify the escape before it', () => {
		expect(prettierLiteralPattern('[+.ts')).toBe('[[][+].ts');
		expect(prettierLiteralPattern('src/routes/+page.svelte')).toBe('src/routes/[+]page.svelte');

		const { repository } = checkout();
		const directory = path.join(repository, 'scripts', `.format-plus-${process.pid}`);
		const relative = `scripts/.format-plus-${process.pid}`;
		mkdirSync(directory, { recursive: true });
		try {
			// Unescaped, `[[]+.ts` quantifies the class and matches the formatted neighbour
			// instead, which is a green run over a file that was never looked at.
			writeFileSync(path.join(directory, '[+.ts'), 'export const a   =1\n');
			writeFileSync(path.join(directory, '[.ts'), 'export const b = 1;\n');

			const result = formatChecks(repository).formatCheck(`${relative}/[+.ts`);
			expect(result.status, result.output).toBe(1);
			expect(result.output).toContain('[+.ts');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('anchors the generated trees .gitignore anchors and no others', () => {
		// /build, /dist and /.svelte-kit are root-anchored in .gitignore, so a tracked
		// src/build/generator.ts is an ordinary source file rather than generated output.
		expect(isNeverWalked('build/output.js')).toBe(true);
		expect(isNeverWalked('dist/output.js')).toBe(true);
		expect(isNeverWalked('.svelte-kit/ambient.d.ts')).toBe(true);
		expect(isNeverWalked('src/build/generator.ts')).toBe(false);
		expect(isNeverWalked('src/lib/dist/value.ts')).toBe(false);
		expect(isNeverWalked('src/redist/value.ts')).toBe(false);

		// node_modules, .git and .convex are ignored at every depth.
		expect(isNeverWalked('packages/app/node_modules/x.js')).toBe(true);
		expect(isNeverWalked('src/.convex/generated.ts')).toBe(true);
	});

	it('accepts the same directory named twice', () => {
		const once = resolveInputs(['scripts'], 'arguments', ROOT);
		expect(resolveInputs(['scripts', 'scripts'], 'arguments', ROOT)).toEqual(once);
	});

	it('documents a Git producer that excludes deleted paths and stays root-relative', () => {
		const source = readFileSync(SCRIPT, 'utf8');
		// --no-relative decides which records the producer emits at all: measured with git
		// 2.55.0 and diff.relative=true, running it from scripts/ reports a change to
		// scripts/AGENTS.md as the record "AGENTS.md" and omits every path above that
		// directory, so the consumer would check the root file of the same name.
		for (const documented of source.matchAll(/git diff [^`]*--name-only[^`]*/g)) {
			expect(documented[0]).toContain('--no-relative');
		}
		expect(source).toContain('git diff --no-relative --name-only --diff-filter=d -z');
	});

	it('rejects the replacement character produced by lossy argv decoding', () => {
		const { repository } = checkout();
		const relative = `.format-replacement-${String.fromCharCode(0xfffd)}-${process.pid}.ts`;
		const file = path.join(repository, relative);
		try {
			writeFileSync(file, 'export const value = 1;\n');
			const result = formatChecks(repository).formatCheck(file);
			expect(result.status).toBe(1);
			expect(result.output).toContain('Unsafe U+FFFD');
			expect(result.output).not.toContain('SvelteKit sync');
		} finally {
			rmSync(file, { force: true });
		}
	});

	it.skipIf(process.platform === 'win32')(
		'rejects unsafe controls even when the computed-list protocol preserves them',
		() => {
			const { repository } = checkout();
			const checker = formatChecks(repository);
			const safe = `.format-newline-${process.pid}.ts`;
			const unsafe = `.format-newline-${process.pid}\n.ts`;
			try {
				writeFileSync(path.join(repository, safe), 'export const value = 1;\n');
				writeFileSync(path.join(repository, unsafe), 'export const value = 1;\n');
				const result = checker.formatCheckFilesFrom(`${unsafe}\0`);
				expect(result.status).toBe(1);
				expect(result.output).toContain('Unsafe U+000A');
				expect(result.output).not.toContain('SvelteKit sync');
			} finally {
				rmSync(path.join(repository, safe), { force: true });
				rmSync(path.join(repository, unsafe), { force: true });
			}
		},
		60_000
	);

	it('rejects an unsafe child without contaminating another repository check', () => {
		const { repository } = checkout();
		const relative = `scripts/.format-unsafe-child-${process.pid}`;
		const directory = path.join(repository, relative);
		const child = `bad${String.fromCharCode(0x202e)}.ts`;
		try {
			mkdirSync(directory, { recursive: true });
			writeFileSync(path.join(directory, child), 'export const value = 1;\n');
			const result = formatChecks(repository).formatCheck(relative);
			expect(result.status, result.output).toBe(1);
			expect(result.output).toContain('Unsafe U+202E');
			expect(result.output).not.toContain('All checks passed');

			// Keep the unsafe fixture alive while a sibling check walks the shared checkout.
			const sibling = spawnSync(testExecutable('bun'), [SCRIPT, '--ci', '--scope', 'compat'], {
				cwd: ROOT,
				env: { ...sanitizedGitEnv(), PATH: '', CI: 'true', CONVEX_COMPAT_BASE: 'missing ref' },
				timeout: 10_000,
				killSignal: 'SIGKILL',
				encoding: 'utf8'
			});
			const output = `${sibling.stdout}${sibling.stderr}`;
			expect(sibling.status, output).toBe(1);
			expect(output).toContain('Convex consumer compatibility');
			expect(output).toContain('CONVEX_COMPAT_BASE=missing ref');
			expect(output).not.toContain('Unsafe U+202E');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
