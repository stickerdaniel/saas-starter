import { spawnSync } from 'child_process';
import {
	chmodSync,
	copyFileSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import knowledgePolicy from '../knowledge-policy.config';
import { sanitizedGitEnv } from './git-context';
import { runKnowledgePolicy } from './knowledge-policy/repository';
import {
	isNeverWalked,
	prettierArguments,
	prettierLiteralPattern,
	prettierProjectPaths,
	prettierTraversalPaths,
	resolveInputs
} from './static-checks';
import { testExecutable } from './test-executable';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'static-checks.ts');

/** Assert-only format run, with the parent's colour and Git context stripped. */
function formatCheck(...args: string[]): { status: number; output: string } {
	const result = spawnSync(testExecutable('bun'), [SCRIPT, '--ci', '--scope', 'format', ...args], {
		cwd: ROOT,
		env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
		encoding: 'utf8'
	});
	return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

/** The computed-list channel used by format-only hook consumers. */
function formatCheckFilesFrom(
	input: string | Uint8Array,
	cwd = ROOT
): { status: number; output: string } {
	const result = spawnSync(
		testExecutable('bun'),
		[SCRIPT, '--ci', '--scope', 'format', '--files-from', '-'],
		{
			cwd,
			env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
			input,
			encoding: 'utf8'
		}
	);
	return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = sanitizedGitEnv()): string {
	const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stdout;
}

function createCheckerClone(coreSymlinks = true): { directory: string; repository: string } {
	const directory = path.join(ROOT, 'scratch', `format-ledger-${process.pid}-${Date.now()}`);
	const repository = path.join(directory, 'repository');
	mkdirSync(directory, { recursive: true });
	try {
		const result = spawnSync(
			'git',
			[
				...(coreSymlinks ? [] : ['-c', 'core.symlinks=false']),
				'clone',
				'--quiet',
				'--local',
				'--no-hardlinks',
				ROOT,
				repository
			],
			{ env: sanitizedGitEnv(), encoding: 'utf8' }
		);
		if (result.status !== 0) throw new Error(`Local checker clone failed: ${result.stderr}`);
		symlinkSync(
			path.join(ROOT, 'node_modules'),
			path.join(repository, 'node_modules'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		for (const file of [
			'.agents/skills/tsconfig.json',
			'.agents/skills/upstream-sync/scripts/find-fork-point.ts',
			'.agents/skills/upstream-sync/scripts/list-upstream-changes.ts',
			'package.json',
			'src/lib/convex/support/instructions.generated.ts',
			'scripts/git-context.ts',
			'scripts/static-checks.ts'
		]) {
			copyFileSync(path.join(ROOT, file), path.join(repository, file));
		}
		return { directory, repository };
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

/** Write an unformatted file into the repository for one assertion. */
function withRepositoryFile(
	name: string,
	contents: string,
	assertion: (file: string) => void
): void {
	const file = path.join(ROOT, name);
	writeFileSync(file, contents);
	try {
		assertion(file);
	} finally {
		rmSync(file, { force: true });
	}
}

describe('format-only static checks', () => {
	it('routes a real Prettier parse error through the terminal boundary', () => {
		const relative = `scripts/.format-control-${process.pid}.ts`;
		const escape = String.fromCharCode(0x1b);
		withRepositoryFile(relative, `export const value = ${escape}[31m;\n`, (file) => {
			const { status, output } = formatCheck(file);
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
	it('checks a repository file whose name begins with dashes', () => {
		const relative = `--format-dash-${process.pid}.ts`;
		withRepositoryFile(relative, 'export const value    =    1;\n', (file) => {
			// "[warn] <file>" is Prettier's own verdict. Without it the run can still exit
			// non-zero for having checked nothing at all, which is the failure this pins.
			const absolute = formatCheck(file);
			expect(absolute.status).not.toBe(0);
			expect(absolute.output).toContain(`[warn] ${relative}`);

			// The same file relayed as a repo-relative path behind an explicit separator.
			const relayed = formatCheck('--', relative);
			expect(relayed.status).not.toBe(0);
			expect(relayed.output).toContain(`[warn] ${relative}`);
			expect(relayed.output).not.toContain('Bad arguments');
		});
	});

	it('keeps a filename whose name begins with a space distinct from its neighbour', () => {
		const plain = `.format-space-${process.pid}.ts`;
		const spaced = ` ${plain}`;
		writeFileSync(path.join(ROOT, spaced), 'export const value    =    1;\n');
		writeFileSync(path.join(ROOT, plain), 'export const value = 1;\n');
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
			rmSync(path.join(ROOT, spaced), { force: true });
			rmSync(path.join(ROOT, plain), { force: true });
		}
	}, 60_000);

	it.skipIf(process.platform === 'win32')('accepts a path made entirely of spaces', () => {
		withRepositoryFile(' ', 'plain text\n', (file) => {
			const result = formatCheckFilesFrom(' \0');
			expect(result.status).toBe(0);
			expect(result.output).toContain('No formatter work');
			expect(result.output).not.toContain('Empty path');
			expect(file).toBe(path.join(ROOT, ' '));
		});
	});

	it('rejects an ambiguous BOM whether it starts the stream or a later path', () => {
		const plain = `.format-bom-${process.pid}.ts`;
		const marked = `${String.fromCharCode(0xfeff)}${plain}`;
		writeFileSync(path.join(ROOT, plain), 'export const value = 1;\n');
		try {
			const first = formatCheckFilesFrom(`${marked}\0${plain}\0`);
			expect(first.status).toBe(1);
			expect(first.output).toContain('without a byte-order mark');

			writeFileSync(path.join(ROOT, marked), 'export const value = 1;\n');
			const later = formatCheckFilesFrom(`${plain}\0${marked}\0`);
			expect(later.status).toBe(1);
			expect(later.output).toContain('Unsafe U+FEFF');
		} finally {
			rmSync(path.join(ROOT, marked), { force: true });
			rmSync(path.join(ROOT, plain), { force: true });
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
			const direct = spawnSync(testExecutable('bun'), ['prettier', '--check', '--', relative], {
				cwd: ROOT,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
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
	});

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
			const directory = path.join(ROOT, 'scripts', `.format-backslash-${process.pid}`);
			const relative = `scripts/.format-backslash-${process.pid}`;
			mkdirSync(directory, { recursive: true });
			try {
				// Only one of the two is malformed. A pattern that drops the backslash checks the
				// other file and reports a formatted repository while the named one stays broken.
				writeFileSync(path.join(directory, 'a\\[b].ts'), 'export const a   =1\n');
				writeFileSync(path.join(directory, 'a[b].ts'), 'export const b = 1;\n');

				const result = formatCheck(`${relative}/a\\[b].ts`);
				expect(result.status, result.output).toBe(1);
				expect(result.output).toContain('a\\[b].ts');
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);

	it('escapes a leading exclamation mark into a pattern Prettier cannot negate', () => {
		expect(prettierLiteralPattern('!a[b].ts')).toBe('@(!)a[[]b@(]).ts');

		withRepositoryFile('!a[b].ts', 'export const a   =1\n', () => {
			const named = formatCheck('!a[b].ts');
			expect(named.status, named.output).toBe(1);
			expect(named.output).toContain('!a[b].ts');
		});

		// The file is gone again here, which is the case a negation turns into a silent pass:
		// measured with Prettier 3.9.5, `./!a[[]b@(]).ts` matched every other root file and
		// exited 0 instead of reporting the path it was given.
		const vanished = spawnSync(
			testExecutable('bun'),
			['prettier', '--check', '--ignore-unknown', '--', prettierLiteralPattern('!a[b].ts')],
			{ cwd: ROOT, env: { ...sanitizedGitEnv(), NO_COLOR: '1' }, encoding: 'utf8' }
		);
		expect(vanished.status).toBe(2);
		expect(`${vanished.stdout}${vanished.stderr}`).toContain('No files matching the pattern');
	});

	it.skipIf(process.platform === 'win32')(
		'erlaubt nur die kanonischen Metadaten-Platzhalter im vollständigen Checkout',
		() => {
			const checkout = createCheckerClone(false);
			try {
				const placeholder = path.join(checkout.repository, 'CLAUDE.md');
				expect(lstatSync(placeholder).isFile()).toBe(true);
				const format = spawnSync(
					testExecutable('bun'),
					[
						checkout.repository + '/scripts/static-checks.ts',
						'--ci',
						'--scope',
						'format',
						placeholder
					],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);
				expect(format.status, `${format.stdout}${format.stderr}`).toBe(0);
				expect(`${format.stdout}${format.stderr}`).toContain('No formatter work');

				for (const scope of ['types', 'lint']) {
					const result = spawnSync(
						testExecutable('bun'),
						[checkout.repository + '/scripts/static-checks.ts', '--scope', scope],
						{
							cwd: checkout.repository,
							env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
							encoding: 'utf8'
						}
					);
					expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
				}

				const alias = path.join(checkout.repository, 'SOURCE.md');
				writeFileSync(alias, 'AGENTS.md');
				const sourceObject = spawnSync('git', ['hash-object', '-w', '--stdin'], {
					cwd: checkout.repository,
					env: sanitizedGitEnv(),
					input: 'AGENTS.md',
					encoding: 'utf8'
				}).stdout.trim();
				git(checkout.repository, [
					'update-index',
					'--add',
					'--cacheinfo',
					`120000,${sourceObject},SOURCE.md`
				]);
				const rejected = spawnSync(
					testExecutable('bun'),
					[checkout.repository + '/scripts/static-checks.ts', '--scope', 'types'],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);
				expect(rejected.status, `${rejected.stdout}${rejected.stderr}`).toBe(1);
				expect(`${rejected.stdout}${rejected.stderr}`).toContain('no materialized source content');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		600_000
	);

	it('aktualisiert nur den kalten und warmen .svelte-kit-Snapshot nach Sync', () => {
		const checkout = createCheckerClone();
		try {
			rmSync(path.join(checkout.repository, '.svelte-kit'), { recursive: true, force: true });
			for (let run = 0; run < 2; run++) {
				const result = spawnSync(
					testExecutable('bun'),
					[path.join(checkout.repository, 'scripts/static-checks.ts'), '--scope', 'lint'],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);
				expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
			}
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 900_000);

	it('verwirft fremde Source-Erzeugung unmittelbar nach SvelteKit sync', () => {
		const checkout = createCheckerClone();
		try {
			const config = path.join(checkout.repository, 'svelte.config.js');
			writeFileSync(
				config,
				`import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./src/sync-created.ts', import.meta.url), 'export const created = true;\\n');\n${readFileSync(config, 'utf8')}`
			);
			const result = spawnSync(
				testExecutable('bun'),
				[path.join(checkout.repository, 'scripts/static-checks.ts'), '--scope', 'lint'],
				{
					cwd: checkout.repository,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
					encoding: 'utf8'
				}
			);
			expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
			expect(`${result.stdout}${result.stderr}`).toContain(
				'Formatter parser classification changed during SvelteKit sync'
			);
			expect(`${result.stdout}${result.stderr}`).not.toContain('Spell checking');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 120_000);

	it.skipIf(process.platform === 'win32')(
		'verwirft einen Aliaswechsel unmittelbar nach SvelteKit sync',
		() => {
			const checkout = createCheckerClone();
			try {
				const config = path.join(checkout.repository, 'svelte.config.js');
				writeFileSync(
					config,
					`import { rmSync, symlinkSync } from 'node:fs';\nconst alias = new URL('./.claude/skills/upstream-sync', import.meta.url);\nrmSync(alias);\nsymlinkSync('../../.agents/skills/upstream-report', alias, 'dir');\n${readFileSync(config, 'utf8')}`
				);
				const result = spawnSync(
					testExecutable('bun'),
					[path.join(checkout.repository, 'scripts/static-checks.ts'), '--scope', 'lint'],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);
				expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
				expect(`${result.stdout}${result.stderr}`).toContain(
					'Symbolic-link chain changed before launch'
				);
				expect(`${result.stdout}${result.stderr}`).not.toContain('Spell checking');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		120_000
	);

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
		const directory = path.join(ROOT, 'scripts', `.format-collide-${process.pid}`);
		const relative = `scripts/.format-collide-${process.pid}`;
		mkdirSync(directory, { recursive: true });
		try {
			writeFileSync(path.join(directory, '[ab].ts'), 'export const a   =1\n');
			writeFileSync(path.join(directory, '[[]ab@(]).ts'), 'export const b = 1;\n');

			const result = formatCheck(`${relative}/[ab].ts`);
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
			const directory = path.join(ROOT, 'scripts', `.format-brace-${process.pid}`);
			const relative = `scripts/.format-brace-${process.pid}`;
			mkdirSync(directory, { recursive: true });
			try {
				// Only the named file is malformed. A pattern that expands into a brace expression
				// either checks the neighbour and passes, or matches nothing and passes.
				writeFileSync(path.join(directory, name), 'export const a   =1\n');
				writeFileSync(path.join(directory, '{}.ts'), 'export const b = 1;\n');

				const result = formatCheck(`${relative}/${name}`);
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

		const directory = path.join(ROOT, 'scripts', `.format-plus-${process.pid}`);
		const relative = `scripts/.format-plus-${process.pid}`;
		mkdirSync(directory, { recursive: true });
		try {
			// Unescaped, `[[]+.ts` quantifies the class and matches the formatted neighbour
			// instead, which is a green run over a file that was never looked at.
			writeFileSync(path.join(directory, '[+.ts'), 'export const a   =1\n');
			writeFileSync(path.join(directory, '[.ts'), 'export const b = 1;\n');

			const result = formatCheck(`${relative}/[+.ts`);
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

	it.skipIf(process.platform === 'win32')(
		'prüft ein explizites Kind auch neben seinem überlappenden Aliasverzeichnis',
		() => {
			const target = path.join(ROOT, 'scratch', `format-overlap-target-${process.pid}`);
			const alias = path.join(ROOT, `.format-overlap-${process.pid}`);
			const child = `${path.basename(alias)}/probe.ts`;
			mkdirSync(target, { recursive: true });
			writeFileSync(path.join(target, 'probe.ts'), 'export const value   =1\n');
			symlinkSync(target, alias, 'dir');
			try {
				for (const records of [
					[path.basename(alias), child],
					[child, path.basename(alias)]
				]) {
					const result = formatCheck(...records);
					expect(result.status, result.output).toBe(1);
					expect(result.output).toContain(child);
				}
				for (const records of [
					`${path.basename(alias)}\0${child}\0`,
					`${child}\0${path.basename(alias)}\0`
				]) {
					const result = formatCheckFilesFrom(records);
					expect(result.status, result.output).toBe(1);
					expect(result.output).toContain(child);
				}
				const directory = formatCheck(path.basename(alias));
				expect(directory.status, directory.output).toBe(0);
				expect(directory.output).toContain('No formatter work');
			} finally {
				rmSync(alias, { force: true });
				rmSync(target, { recursive: true, force: true });
			}
		},
		120_000
	);

	it.skipIf(process.platform === 'win32')(
		'behandelt echte Gitlinks atomar und prüft ihren Index-OID',
		() => {
			const checkout = createCheckerClone();
			const source = path.join(checkout.directory, 'submodule-source');
			const submodule = path.join(checkout.repository, 'vendor', 'probe');
			try {
				mkdirSync(source);
				git(source, ['init', '-q', '-b', 'main']);
				git(source, ['config', 'user.email', 'test@example.com']);
				git(source, ['config', 'user.name', 'Test']);
				git(source, ['config', 'commit.gpgsign', 'false']);
				writeFileSync(path.join(source, 'probe.ts'), 'export const probe = 1;\n');
				git(source, ['add', 'probe.ts']);
				git(source, ['commit', '-qm', 'Initial']);
				const first = git(source, ['rev-parse', 'HEAD']).trim();

				git(checkout.repository, ['config', 'user.email', 'test@example.com']);
				git(checkout.repository, ['config', 'user.name', 'Test']);
				git(checkout.repository, ['config', 'commit.gpgsign', 'false']);
				git(checkout.repository, [
					'-c',
					'protocol.file.allow=always',
					'submodule',
					'add',
					'-q',
					source,
					'vendor/probe'
				]);
				git(checkout.repository, ['add', '.']);
				git(checkout.repository, ['commit', '-qm', 'Checker fixture']);

				for (const scope of ['types', 'lint']) {
					const result = spawnSync(
						testExecutable('bun'),
						[path.join(checkout.repository, 'scripts/static-checks.ts'), '--scope', scope],
						{
							cwd: checkout.repository,
							env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
							encoding: 'utf8'
						}
					);
					expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
				}

				writeFileSync(path.join(source, 'probe.ts'), 'export const probe = 2;\n');
				git(source, ['add', 'probe.ts']);
				git(source, ['commit', '-qm', 'Update']);
				const second = git(source, ['rev-parse', 'HEAD']).trim();
				git(submodule, ['fetch', '-q', 'origin']);
				git(submodule, ['checkout', '-q', second]);
				git(checkout.repository, ['add', 'vendor/probe']);

				const staged = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts/static-checks.ts'),
						'--staged',
						'--scope',
						'lint'
					],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);
				expect(staged.status, `${staged.stdout}${staged.stderr}`).toBe(0);
				expect(`${staged.stdout}${staged.stderr}`).toContain('verified gitlink object IDs');

				git(submodule, ['checkout', '-q', first]);
				const mismatch = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts/static-checks.ts'),
						'--staged',
						'--scope',
						'lint'
					],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);
				expect(mismatch.status, `${mismatch.stdout}${mismatch.stderr}`).toBe(1);
				expect(`${mismatch.stdout}${mismatch.stderr}`).toContain(
					'Staged file contents differ from the worktree'
				);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		360_000
	);

	it.skipIf(process.platform === 'win32')(
		'behandelt Gitlinks durch einen Alias-Vorfahren atomar',
		() => {
			const checkout = createCheckerClone();
			const source = path.join(checkout.directory, 'aliased-submodule-source');
			const submodule = path.join(checkout.repository, 'vendor', 'probe');
			const aliasRelative = 'alias';
			const alias = path.join(checkout.repository, aliasRelative);
			const aliasGitlinkRelative = `${aliasRelative}/probe`;
			const gitlinkRelative = 'vendor/probe';
			const leafAliasRelative = 'vendor/probe-link';
			const leafAlias = path.join(checkout.repository, leafAliasRelative);
			const deletionRelative = 'scripts/gitlink-deletion.md';
			const contentRelative = 'scripts/gitlink-content.ts';
			try {
				mkdirSync(source);
				git(source, ['init', '-q', '-b', 'main']);
				git(source, ['config', 'user.email', 'test@example.com']);
				git(source, ['config', 'user.name', 'Test']);
				git(source, ['config', 'commit.gpgsign', 'false']);
				writeFileSync(path.join(source, 'probe.ts'), 'export const probe = 1;\n');
				git(source, ['add', 'probe.ts']);
				git(source, ['commit', '-qm', 'Initial']);

				git(checkout.repository, ['config', 'user.email', 'test@example.com']);
				git(checkout.repository, ['config', 'user.name', 'Test']);
				git(checkout.repository, ['config', 'commit.gpgsign', 'false']);
				git(checkout.repository, [
					'-c',
					'protocol.file.allow=always',
					'submodule',
					'add',
					'-q',
					source,
					gitlinkRelative
				]);
				symlinkSync('vendor', alias, 'dir');
				symlinkSync('probe', leafAlias, 'dir');
				writeFileSync(path.join(checkout.repository, deletionRelative), '# delete me\n');
				git(checkout.repository, ['add', '.']);
				git(checkout.repository, ['commit', '-qm', 'Aliased gitlink fixture']);

				const resolveRecord = (requested: string) => {
					const resolved = spawnSync(
						testExecutable('bun'),
						[
							'-e',
							`import { resolveInputRecords } from './scripts/static-checks.ts'; const record = resolveInputRecords(${JSON.stringify([requested])}, 'test', process.cwd())[0]; console.log(JSON.stringify({ path: record?.path, target: record?.target, kind: record?.kind, linkChain: record?.linkChain, inventoryPaths: record?.inventoryPaths, formatterLinkNoop: record?.formatterLinkNoop }));`
						],
						{ cwd: checkout.repository, env: sanitizedGitEnv(), encoding: 'utf8' }
					);
					expect(resolved.status, `${resolved.stdout}${resolved.stderr}`).toBe(0);
					return JSON.parse(resolved.stdout);
				};
				for (const requested of [aliasRelative, aliasGitlinkRelative]) {
					expect(resolveRecord(requested)).toMatchObject({
						path: aliasGitlinkRelative,
						target: gitlinkRelative,
						kind: 'gitlink',
						linkChain: [{ path: aliasRelative, target: 'vendor' }],
						inventoryPaths: [aliasRelative, gitlinkRelative],
						formatterLinkNoop: true
					});
				}
				expect(resolveRecord(leafAliasRelative)).toMatchObject({
					path: leafAliasRelative,
					target: gitlinkRelative,
					kind: 'gitlink',
					linkChain: [{ path: leafAliasRelative, target: 'probe' }],
					inventoryPaths: [leafAliasRelative, gitlinkRelative],
					formatterLinkNoop: true
				});

				const tools = path.join(checkout.directory, 'gitlink-tools');
				mkdirSync(tools);
				const childBun = path.join(tools, 'bun');
				writeFileSync(childBun, '#!/bin/sh\nexit 0\n');
				chmodSync(childBun, 0o755);
				const env = {
					...sanitizedGitEnv(),
					NO_COLOR: '1',
					PATH: `${tools}${path.delimiter}${process.env.PATH ?? ''}`
				};
				const runTypes = (paths: string[], nul = false) => {
					const result = spawnSync(
						testExecutable('bun'),
						[
							path.join(checkout.repository, 'scripts/static-checks.ts'),
							'--scope',
							'types',
							...(nul ? ['--files-from', '-'] : paths)
						],
						{
							cwd: checkout.repository,
							env,
							input: nul ? `${paths.join('\0')}\0` : undefined,
							encoding: 'utf8'
						}
					);
					return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
				};

				const fileGitlink = runTypes([gitlinkRelative]);
				const aliases = [
					runTypes([aliasRelative]),
					runTypes([aliasGitlinkRelative]),
					runTypes([leafAliasRelative]),
					runTypes([aliasRelative, aliasGitlinkRelative]),
					runTypes([aliasGitlinkRelative, aliasRelative]),
					runTypes([aliasRelative, aliasGitlinkRelative], true),
					runTypes([aliasGitlinkRelative, aliasRelative], true)
				];

				writeFileSync(
					path.join(checkout.repository, contentRelative),
					'export const content   =1\n'
				);
				const content = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts/static-checks.ts'),
						'--ci',
						'--scope',
						'format',
						gitlinkRelative,
						contentRelative
					],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);

				writeFileSync(path.join(source, 'probe.ts'), 'export const probe = 2;\n');
				git(source, ['add', 'probe.ts']);
				git(source, ['commit', '-qm', 'Update']);
				const second = git(source, ['rev-parse', 'HEAD']).trim();
				git(submodule, ['fetch', '-q', 'origin']);
				git(submodule, ['checkout', '-q', second]);
				git(checkout.repository, ['add', gitlinkRelative]);
				git(checkout.repository, ['rm', '--quiet', '--', deletionRelative]);
				const staged = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts/static-checks.ts'),
						'--staged',
						'--scope',
						'types'
					],
					{ cwd: checkout.repository, env, encoding: 'utf8' }
				);

				const config = path.join(checkout.repository, 'svelte.config.js');
				writeFileSync(
					config,
					`import { rmSync, symlinkSync } from 'node:fs';\nconst alias = new URL('./${aliasRelative}', import.meta.url);\nrmSync(alias);\nsymlinkSync('scripts', alias, 'dir');\n${readFileSync(config, 'utf8')}`
				);
				const switched = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts/static-checks.ts'),
						'--scope',
						'types',
						aliasRelative
					],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);

				const allOutput = [
					fileGitlink.output,
					...aliases.map((result) => result.output),
					`${content.stdout}${content.stderr}`,
					`${staged.stdout}${staged.stderr}`,
					`${switched.stdout}${switched.stderr}`
				].join('\n--- RUN ---\n');
				expect(
					[
						fileGitlink.status,
						...aliases.map((result) => result.status),
						content.status,
						staged.status,
						switched.status
					],
					allOutput
				).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1]);
				expect(fileGitlink.output).toContain('verified gitlink without source files to check');
				for (const result of aliases) {
					expect(result.output).toContain('verified gitlink');
					expect(result.output).toContain('without source files to check');
					expect(result.output).not.toContain('Directory contains no files to check');
				}
				expect(`${content.stdout}${content.stderr}`).toContain(`[warn] ${contentRelative}`);
				expect(`${content.stdout}${content.stderr}`).not.toContain(`${gitlinkRelative}/probe.ts`);
				expect(`${staged.stdout}${staged.stderr}`).toContain(
					'verified gitlink updates and deletions without source files to check'
				);
				expect(`${switched.stdout}${switched.stderr}`).toContain(
					'Symbolic-link chain changed before launch'
				);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		240_000
	);

	it.skipIf(process.platform === 'win32')(
		'verwirft einen neuen Symlink in einem Gitlink-Elternsegment vor dem Verbrauch',
		() => {
			const checkout = createCheckerClone();
			const source = path.join(checkout.directory, 'retargeted-submodule-source');
			const gitlinkRelative = 'vendor/probe';
			const submodule = path.join(checkout.repository, gitlinkRelative);
			const aliasRelative = 'alias';
			const aliasGitlinkRelative = `${aliasRelative}/probe`;
			try {
				mkdirSync(source);
				git(source, ['init', '-q', '-b', 'main']);
				git(source, ['config', 'user.email', 'test@example.com']);
				git(source, ['config', 'user.name', 'Test']);
				git(source, ['config', 'commit.gpgsign', 'false']);
				writeFileSync(path.join(source, 'probe.ts'), 'export const probe = 1;\n');
				git(source, ['add', 'probe.ts']);
				git(source, ['commit', '-qm', 'Initial']);

				git(checkout.repository, ['config', 'user.email', 'test@example.com']);
				git(checkout.repository, ['config', 'user.name', 'Test']);
				git(checkout.repository, ['config', 'commit.gpgsign', 'false']);
				git(checkout.repository, [
					'-c',
					'protocol.file.allow=always',
					'submodule',
					'add',
					'-q',
					source,
					gitlinkRelative
				]);
				const initialHead = git(submodule, ['rev-parse', 'HEAD']).trim();
				symlinkSync('vendor', path.join(checkout.repository, aliasRelative), 'dir');
				git(checkout.repository, ['add', '.']);
				git(checkout.repository, ['commit', '-qm', 'Gitlink retarget fixture']);

				const config = path.join(checkout.repository, 'svelte.config.js');
				writeFileSync(
					config,
					`import { existsSync, renameSync, symlinkSync } from 'node:fs';\nconst vendor = new URL('./vendor', import.meta.url);\nconst vendorReal = new URL('./vendor-real', import.meta.url);\nif (!existsSync(vendorReal)) {\n\trenameSync(vendor, vendorReal);\n\tsymlinkSync('vendor-real', vendor, 'dir');\n}\n${readFileSync(config, 'utf8')}`
				);
				const result = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts/static-checks.ts'),
						'--ci',
						'--scope',
						'types',
						aliasRelative,
						'src/lib/utils/math.ts'
					],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);
				const output = `${result.stdout}${result.stderr}`;
				const vendor = path.join(checkout.repository, 'vendor');
				expect(lstatSync(vendor).isSymbolicLink()).toBe(true);
				expect(readlinkSync(vendor)).toBe('vendor-real');
				expect(readlinkSync(path.join(checkout.repository, aliasRelative))).toBe('vendor');
				expect(git(submodule, ['rev-parse', 'HEAD']).trim()).toBe(initialHead);
				expect(result.status, output).toBe(1);
				expect(output).toContain('Path target changed before launch');
				expect(output).toContain(aliasGitlinkRelative);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		120_000
	);

	it.each([true, false])(
		'hasht einen regulären Mode-120000-Typwechsel mit core.symlinks=%s',
		(coreSymlinks) => {
			const checkout = createCheckerClone(coreSymlinks);
			try {
				const relative = 'scripts/type-change.ts';
				const file = path.join(checkout.repository, relative);
				const pointer = 'target.ts';
				const objectId = spawnSync('git', ['hash-object', '-w', '--stdin'], {
					cwd: checkout.repository,
					env: sanitizedGitEnv(),
					input: pointer,
					encoding: 'utf8'
				}).stdout.trim();
				git(checkout.repository, [
					'update-index',
					'--add',
					'--cacheinfo',
					`120000,${objectId},${relative}`
				]);
				writeFileSync(file, pointer);

				const unchanged = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts/static-checks.ts'),
						'--ci',
						'--scope',
						'format',
						relative
					],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);
				expect(unchanged.status, `${unchanged.stdout}${unchanged.stderr}`).toBe(0);

				writeFileSync(file, 'export const changed   =1\n');
				const direct = spawnSync(testExecutable('bun'), ['prettier', '--check', '--', relative], {
					cwd: checkout.repository,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
					encoding: 'utf8'
				});
				expect(direct.status, `${direct.stdout}${direct.stderr}`).toBe(1);
				const changed = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts/static-checks.ts'),
						'--ci',
						'--scope',
						'format',
						relative
					],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);
				expect(changed.status, `${changed.stdout}${changed.stderr}`).toBe(1);
				expect(`${changed.stdout}${changed.stderr}`).toContain(relative);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		120_000
	);

	it('ignores only the repository root CLAUDE.md pointer', () => {
		const ignore = readFileSync(path.join(ROOT, '.prettierignore'), 'utf8');
		expect(ignore).toContain('/CLAUDE.md');

		withRepositoryFile('scripts/CLAUDE.md', '# Nested\n', () => {
			const result = formatCheck('scripts/CLAUDE.md');
			expect(result.status, result.output).toBe(0);
			expect(result.output).toContain('prettier         1 file(s)');
		});
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
		const relative = `.format-replacement-${String.fromCharCode(0xfffd)}-${process.pid}.ts`;
		withRepositoryFile(relative, 'export const value = 1;\n', (file) => {
			const result = formatCheck(file);
			expect(result.status).toBe(1);
			expect(result.output).toContain('Unsafe U+FFFD');
			expect(result.output).not.toContain('SvelteKit sync');
		});
	});

	it.skipIf(process.platform === 'win32')(
		'rejects unsafe controls even when the computed-list protocol preserves them',
		() => {
			const safe = `.format-newline-${process.pid}.ts`;
			const unsafe = `.format-newline-${process.pid}\n.ts`;
			writeFileSync(path.join(ROOT, safe), 'export const value = 1;\n');
			writeFileSync(path.join(ROOT, unsafe), 'export const value = 1;\n');
			try {
				const result = formatCheckFilesFrom(`${unsafe}\0`);
				expect(result.status).toBe(1);
				expect(result.output).toContain('Unsafe U+000A');
				expect(result.output).not.toContain('SvelteKit sync');
			} finally {
				rmSync(path.join(ROOT, unsafe), { force: true });
				rmSync(path.join(ROOT, safe), { force: true });
			}
		},
		60_000
	);

	it('rejects an unsafe child expanded from a safe formatter directory', () => {
		const relative = `scripts/.format-unsafe-child-${process.pid}`;
		const directory = path.join(ROOT, relative);
		const child = `bad${String.fromCharCode(0x202e)}.ts`;
		mkdirSync(directory, { recursive: true });
		writeFileSync(path.join(directory, child), 'export const value = 1;\n');
		try {
			const result = formatCheck(relative);
			expect(result.status, result.output).toBe(1);
			expect(result.output).toContain('Unsafe U+202E');
			expect(result.output).not.toContain('All checks passed');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('treats an explicitly named repository symlink like the project traversal', () => {
		const { status, output } = formatCheck(path.join(ROOT, 'CLAUDE.md'));
		expect(status).toBe(0);
		expect(output).toContain('No formatter work');
		expect(output).toContain('symbolic link');
		expect(output).toContain('prettier         0 file(s)');
		expect(output).not.toContain('[warn] AGENTS.md');
	});

	it.skipIf(process.platform === 'win32')(
		'treats an explicitly named directory symlink like the project traversal',
		() => {
			const relative = `.format-directory-link-${process.pid}`;
			const file = path.join(ROOT, relative);
			symlinkSync(path.join(ROOT, 'scripts'), file, 'dir');
			try {
				const { status, output } = formatCheck(file);
				expect(status).toBe(0);
				expect(output).toContain('No formatter work');
				expect(output).toContain('prettier         0 file(s)');
				expect(output).not.toContain('scripts/static-checks.ts');
			} finally {
				rmSync(file, { force: true });
			}
		}
	);

	it.skipIf(process.platform === 'win32')(
		'preserves a named path through a symlinked ancestor',
		() => {
			const targetRelative = `scratch/format-symlink-target-${process.pid}`;
			const target = path.join(ROOT, targetRelative);
			const aliasRelative = `.format-symlink-alias-${process.pid}`;
			const alias = path.join(ROOT, aliasRelative);
			const named = `${aliasRelative}/probe.ts`;
			const namedDirectory = `${aliasRelative}/subdir`;
			mkdirSync(path.join(target, 'subdir'), { recursive: true });
			writeFileSync(path.join(target, 'probe.ts'), 'export const value   =1\n');
			writeFileSync(path.join(target, 'subdir', 'nested.ts'), 'export const nested   =1\n');
			symlinkSync(target, alias, 'dir');
			try {
				// The target is ignored as root scratch, while the caller-visible alias is not.
				// Canonicalizing the ancestor classified the alias under the target's ignore rule and
				// turned this direct Prettier failure into a zero-file pass.
				const direct = spawnSync(testExecutable('bun'), ['prettier', '--check', '--', named], {
					cwd: ROOT,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
					encoding: 'utf8'
				});
				expect(direct.status, `${direct.stdout}${direct.stderr}`).toBe(1);

				expect(resolveInputs([named], 'arguments', ROOT, undefined, false)).toEqual([named]);
				const result = formatCheck(named);
				expect(result.status, result.output).toBe(1);
				expect(result.output).toContain(named);
				expect(result.output).not.toContain('No formatter work');

				// Directory traversal reads the resolved target, then maps every child back below
				// the alias before ignore classification and launch.
				expect(
					resolveInputs(
						[namedDirectory],
						'arguments',
						ROOT,
						(directory) => prettierTraversalPaths(directory, false, ROOT),
						false
					)
				).toEqual([`${namedDirectory}/nested.ts`]);
				const directory = formatCheck(namedDirectory);
				expect(directory.status, directory.output).toBe(1);
				expect(directory.output).toContain(`${namedDirectory}/nested.ts`);
				expect(directory.output).not.toContain('No formatter work');
			} finally {
				rmSync(alias, { force: true });
				rmSync(target, { recursive: true, force: true });
			}
		}
	);

	it.each(['.git', '.sl', '.svn', '.hg', '.jj'])(
		"counts Prettier's hard-coded %s exclusion as zero formatter work",
		(vcsDirectory) => {
			const parent = path.join(ROOT, 'scripts', `.format-vcs-${process.pid}`);
			const directory = path.join(parent, vcsDirectory);
			const relative = `scripts/.format-vcs-${process.pid}/${vcsDirectory}/probe.ts`;
			mkdirSync(directory, { recursive: true });
			writeFileSync(path.join(ROOT, relative), 'export const skipped   =1\n');
			try {
				// Prettier's CLI drops these path segments before expansion. `getFileInfo` does not,
				// so the classifier carries the same closed list instead of claiming this file was
				// checked when a formatted peer gives the CLI a successful match.
				const direct = spawnSync(
					testExecutable('bun'),
					['prettier', '--check', '--', relative, 'README.md'],
					{ cwd: ROOT, env: { ...sanitizedGitEnv(), NO_COLOR: '1' }, encoding: 'utf8' }
				);
				expect(direct.status, `${direct.stdout}${direct.stderr}`).toBe(0);
				expect(`${direct.stdout}${direct.stderr}`).not.toContain(relative);

				const result = formatCheckFilesFrom(`${relative}\0README.md\0`);
				expect(result.status, result.output).toBe(0);
				expect(result.output).toContain('prettier         1 file(s)');
				expect(result.output).not.toContain(relative);
			} finally {
				rmSync(parent, { recursive: true, force: true });
			}
		}
	);

	it.skipIf(process.platform === 'win32')(
		'rejects an absolute path through an external checkout alias',
		() => {
			const directory = mkdtempSync(path.join(tmpdir(), 'format-checkout-alias-'));
			const alias = path.join(directory, 'repository');
			const target = path.join(ROOT, 'scratch', `format-alias-${process.pid}`);
			mkdirSync(target, { recursive: true });
			writeFileSync(path.join(target, 'probe.ts'), 'export const value   =1\n');
			symlinkSync(ROOT, alias, 'dir');
			const named = path.join(alias, 'scratch', `format-alias-${process.pid}`, 'probe.ts');
			try {
				// Direct Prettier classifies the caller-visible alias outside the repository, so the
				// root-anchored scratch ignore does not match and the unformatted file is checked.
				const direct = spawnSync(testExecutable('bun'), ['prettier', '--check', '--', named], {
					cwd: alias,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
					encoding: 'utf8'
				});
				expect(direct.status, `${direct.stdout}${direct.stderr}`).toBe(1);

				// A repository-relative ledger cannot preserve that external spelling. Canonicalizing
				// it to root scratch produced a zero-file success, so the boundary fails closed.
				const result = spawnSync(testExecutable('bun'), [SCRIPT, '--scope', 'format', named], {
					cwd: alias,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
					encoding: 'utf8'
				});
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toContain('outside the repository');
				expect(output).not.toContain('All checks passed');
			} finally {
				rmSync(target, { recursive: true, force: true });
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);

	it.skipIf(process.platform === 'win32')(
		'rejects a special file Prettier would drop from a mixed batch',
		() => {
			const relative = `scripts/.format-fifo-${process.pid}.ts`;
			const file = path.join(ROOT, relative);
			const created = spawnSync('mkfifo', [file], { encoding: 'utf8' });
			expect(created.status, created.stderr).toBe(0);
			try {
				const result = formatCheckFilesFrom(`${relative}\0package.json\0`);
				expect(result.status, result.output).toBe(1);
				expect(result.output).toContain('not a regular file');
				expect(result.output).toContain(relative);
				expect(result.output).not.toContain('All checks passed');
			} finally {
				rmSync(file, { force: true });
			}
		}
	);

	it.skipIf(process.platform === 'win32')(
		'rejects a repository symlink to an external file',
		() => {
			const external = mkdtempSync(path.join(tmpdir(), 'format-external-link-'));
			const target = path.join(external, 'target.ts');
			const file = path.join(ROOT, `.format-external-link-${process.pid}.ts`);
			writeFileSync(target, 'export const external = true;\n');
			symlinkSync(target, file);
			try {
				const { status, output } = formatCheck(file);
				expect(status).toBe(1);
				expect(output).toContain('outside the repository');
				expect(output).not.toContain('Code formatting');
			} finally {
				rmSync(file, { force: true });
				rmSync(external, { recursive: true, force: true });
			}
		}
	);

	it.skipIf(process.platform !== 'linux')(
		'rejects repository paths whose bytes are not valid UTF-8',
		() => {
			const relative = Buffer.concat([
				Buffer.from(`.format-invalid-utf8-${process.pid}-`),
				Buffer.from([0xff]),
				Buffer.from('.ts')
			]);
			const invalid = Buffer.concat([Buffer.from(`${ROOT}/`), relative]);
			writeFileSync(invalid, 'export const value = 1;\n');
			try {
				const result = formatCheckFilesFrom(Buffer.concat([relative, Buffer.from([0])]));
				expect(result.status).toBe(1);
				expect(result.output).toContain('bytes that are not valid UTF-8');
				expect(result.output).not.toContain('SvelteKit sync');
			} finally {
				rmSync(invalid, { force: true });
			}
		},
		60_000
	);

	it('keeps locally Git-ignored files in an explicit Prettier directory', () => {
		const directory = `.format-local-ignore-${process.pid}`;
		const ignored = `${directory}/ignored.ts`;
		const excludesDirectory = mkdtempSync(path.join(tmpdir(), 'format-local-ignore-'));
		const excludes = path.join(excludesDirectory, 'excludes');
		const saved = new Map<string, string | undefined>();
		for (const key of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) {
			saved.set(key, process.env[key]);
		}
		mkdirSync(path.join(ROOT, directory));
		writeFileSync(path.join(ROOT, directory, 'kept.ts'), 'export const kept = true;\n');
		writeFileSync(path.join(ROOT, ignored), 'export const ignored    =    true;\n');
		writeFileSync(excludes, `${ignored}\n`);
		process.env.GIT_CONFIG_COUNT = '1';
		process.env.GIT_CONFIG_KEY_0 = 'core.excludesFile';
		process.env.GIT_CONFIG_VALUE_0 = excludes;
		try {
			const result = formatCheck(path.join(ROOT, directory));
			expect(result.status).not.toBe(0);
			expect(result.output).toContain(`[warn] ${ignored}`);
		} finally {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			rmSync(path.join(ROOT, directory), { recursive: true, force: true });
			rmSync(excludesDirectory, { recursive: true, force: true });
		}
	});

	it('checks a web app manifest with the real formatter', () => {
		const relative = `format-manifest-${process.pid}.webmanifest`;
		withRepositoryFile(relative, '{"name":   "Fixture"}\n', (file) => {
			const { status, output } = formatCheck(file);
			expect(status).not.toBe(0);
			expect(output).toContain(`[warn] ${relative}`);
		});
	});

	// Four filenames the hand-written extension grammar did not have and Prettier does.
	// Each one is written unformatted and has to come back as Prettier's own "[warn]",
	// because a route that merely stops rejecting them would still be green here if the
	// file never reached the formatter.
	it.each([
		['a Markdown README spelled in full', 'markdown', '#  Title\n\n\ntext   \n'],
		['a Babel configuration', 'babelrc', '{"presets":   []}\n'],
		['GeoJSON', 'geojson', '{"type":   "Point"}\n'],
		['MJML', 'mjml', '<mjml><mj-body>   <mj-text>hi</mj-text></mj-body></mjml>\n']
	])('checks %s', (_label, kind, contents) => {
		// .babelrc is matched by its exact basename, so it cannot carry a unique suffix.
		// A directory of its own keeps it out of the repository root and off every tool
		// that would otherwise pick up a stray configuration file.
		const directory = `scripts/.format-${kind}-${process.pid}`;
		const name = kind === 'babelrc' ? '.babelrc' : `README.${kind}`;
		const relative = `${directory}/${name}`;
		mkdirSync(path.join(ROOT, directory), { recursive: true });
		try {
			withRepositoryFile(relative, contents, (file) => {
				const { status, output } = formatCheck(file);
				expect(status).not.toBe(0);
				expect(output).toContain(`[warn] ${relative}`);
			});
		} finally {
			rmSync(path.join(ROOT, directory), { recursive: true, force: true });
		}
	});

	// Prettier is the only check in a format scope, so it can answer for the whole run:
	// a file it would skip is not work anyone is owed, and saying so is honest rather
	// than a hole. The two ways to be skipped are pinned separately because they arrive
	// from different places, the parser table and the ignore files.
	it('reports an honest no-op for a file Prettier has no parser for', () => {
		const relative = `format-unknown-${process.pid}.bin`;
		withRepositoryFile(relative, 'not source\n', (file) => {
			const { status, output } = formatCheck(file);
			expect(status).toBe(0);
			expect(output).toContain('No formatter work');
			expect(output).toContain('unknown file type');
			expect(output).not.toContain('[warn]');
		});
	});

	it('reports an honest no-op for a file the formatter ignores', () => {
		// src/env.d.ts is generated and excluded by .prettierignore, so the CLI would skip
		// it. Counting it as formatter work would report a check that never happened.
		const { status, output } = formatCheck(path.join(ROOT, 'src/env.d.ts'));
		expect(status).toBe(0);
		expect(output).toContain('No formatter work');
		expect(output).toContain('prettier         0 file(s)');
	});

	// The honest no-op above is the format scope's alone. Everywhere else, a named file
	// no check covers is still the bug it always was: src/i18n is excluded from spell
	// checking, so a binary there is routed by nothing at all. The scope is "types"
	// because a lint run ends in a whole-project oxlint, and the sibling terminal-output
	// suite deletes .ts fixtures under it mid-walk; the invariant is scope-agnostic, so
	// pinning it from a scope without that walk avoids inheriting the race.
	it('still refuses to go green on a run no check is responsible for', () => {
		const relative = `src/i18n/format-unroutable-${process.pid}.bin`;
		withRepositoryFile(relative, '', (file) => {
			const result = spawnSync(testExecutable('bun'), [SCRIPT, '--scope', 'types', file], {
				cwd: ROOT,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
				encoding: 'utf8'
			});
			expect(result.status).toBe(1);
			expect(`${result.stdout}${result.stderr}`).toContain('no check ran over any of them');
		});
	}, 60_000);

	it('does not reinterpret a disappeared formatter path as a glob', () => {
		const directory = `scripts/.format-glob-${process.pid}`;
		const named = `${directory}/[ab].ts`;
		const neighbour = `${directory}/a.ts`;
		mkdirSync(path.join(ROOT, directory), { recursive: true });
		writeFileSync(path.join(ROOT, named), 'export const named = true;\n');
		writeFileSync(path.join(ROOT, neighbour), 'export const neighbour = true;\n');
		try {
			const selected = prettierProjectPaths([named], ROOT, true);
			rmSync(path.join(ROOT, named));

			const raw = spawnSync(
				testExecutable('bun'),
				['prettier', '--check', '--ignore-unknown', '--', named],
				{ cwd: ROOT, env: { ...sanitizedGitEnv(), NO_COLOR: '1' }, encoding: 'utf8' }
			);
			const escaped = spawnSync(testExecutable('bun'), prettierArguments('--check', selected), {
				cwd: ROOT,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
				encoding: 'utf8'
			});

			expect(raw.status, `${raw.stdout}${raw.stderr}`).toBe(0);
			expect(escaped.status).not.toBe(0);
			expect(`${escaped.stdout}${escaped.stderr}`).toContain('No files matching the pattern');
		} finally {
			rmSync(path.join(ROOT, directory), { recursive: true, force: true });
		}
	});

	it('accepts the repository root as an explicit format directory', () => {
		const seen: string[] = [];
		const inputs = resolveInputs(['.'], 'arguments', ROOT, (directory) => {
			seen.push(directory);
			return ['README.md', 'scripts/static-checks.ts'];
		});

		expect(seen).toEqual([ROOT]);
		expect(inputs).toEqual(['README.md', 'scripts/static-checks.ts']);
	});

	it('traverses only the explicitly named format directory', () => {
		const scripts = path.join(ROOT, 'scripts');
		const files = prettierTraversalPaths(scripts, false, ROOT);

		expect(files.length).toBeGreaterThan(0);
		expect(files.every((file) => file.startsWith('scripts/'))).toBe(true);
		expect(files).not.toContain('.svelte-kit/ambient.d.ts');
	});

	it('fails if a named formatter input disappears before routing', () => {
		const result = spawnSync(
			testExecutable('bun'),
			[
				'-e',
				'import { prettierProjectPaths } from "./scripts/static-checks.ts"; prettierProjectPaths([".missing-format-input"], process.cwd(), true);'
			],
			{ cwd: ROOT, env: { ...sanitizedGitEnv(), NO_COLOR: '1' }, encoding: 'utf8' }
		);
		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).toContain('disappeared before formatter routing');
	});

	it('keeps a root file whose name begins with dots inside the repository', () => {
		const relative = `..format-dots-${process.pid}.ts`;
		withRepositoryFile(relative, 'export const value    =    1;\n', (file) => {
			const { status, output } = formatCheck(file);
			expect(status).not.toBe(0);
			expect(output).toContain(`[warn] ${relative}`);
			expect(output).not.toContain('outside the repository');
		});
	});
});

describe('scope routing', () => {
	it('erfasst einen echten Typfehler in einem zuvor ungedeckten Skill', () => {
		const checkout = createCheckerClone();
		const skill = path.join(checkout.repository, '.agents', 'skills', 'type-error', 'scripts');
		mkdirSync(skill, { recursive: true });
		copyFileSync(
			path.join(ROOT, '.agents', 'skills', 'tsconfig.json'),
			path.join(checkout.repository, '.agents', 'skills', 'tsconfig.json')
		);
		writeFileSync(path.join(skill, 'probe.ts'), 'const value: string = 1;\nvoid value;\n');
		try {
			const result = spawnSync(
				testExecutable('bun'),
				['tsc', '-p', '.agents/skills/tsconfig.json'],
				{
					cwd: checkout.repository,
					env: sanitizedGitEnv(),
					encoding: 'utf8'
				}
			);
			expect(result.status, `${result.stdout}${result.stderr}`).toBe(2);
			expect(`${result.stdout}${result.stderr}`).toContain('type-error/scripts/probe.ts');
			expect(`${result.stdout}${result.stderr}`).toContain("not assignable to type 'string'");
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 120_000);

	// Session artifacts and an interrupted fixture both leave whole trees under `scratch/`,
	// and every project-wide tool walks the repository itself. Asserting the configuration
	// files contain the string proves nothing: it stays green when the pattern moves into a
	// comment or a block that never applies. Each tool is asked instead.
	it('keeps scratch out of project-wide checks', () => {
		const directory = path.join(ROOT, 'scratch', `exclusion-${process.pid}`);
		const relative = `scratch/exclusion-${process.pid}/abandoned.test.ts`;
		const markdown = `scratch/exclusion-${process.pid}/review.md`;
		mkdirSync(directory, { recursive: true });
		const run = (args: string[]) =>
			spawnSync(testExecutable('bun'), args, {
				cwd: ROOT,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
				encoding: 'utf8'
			});
		try {
			// Invalid TypeScript, an unused binding and a test file name in one: whichever tool
			// reads it has something to say about it.
			writeFileSync(
				path.join(directory, 'abandoned.test.ts'),
				'const unused = ;\nexport function broken(: never {}\n'
			);
			writeFileSync(path.join(ROOT, markdown), '[missing](missing.md)\n');

			const policy = runKnowledgePolicy({
				root: ROOT,
				policy: knowledgePolicy,
				scope: { kind: 'files', files: [markdown] }
			});
			expect(policy.filesEvaluated).toBe(0);
			expect(policy.findings).toEqual([]);

			const oxlint = run(['oxlint']);
			expect(`${oxlint.stdout}${oxlint.stderr}`).not.toContain('abandoned.test.ts');

			const vitest = run(['vitest', 'list', '--filesOnly']);
			expect(`${vitest.stdout}${vitest.stderr}`).not.toContain('abandoned.test.ts');

			// ESLint is asked about the file directly rather than over the project, which takes
			// minutes: naming an ignored path is how it reports the ignore rule as applied.
			const eslint = run(['eslint', relative]);
			const output = `${eslint.stdout}${eslint.stderr}`;
			expect(output).toContain('File ignored because of a matching ignore pattern');
			expect(output).not.toContain('Parsing error');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 240_000);

	it('records a numeric formatter count in an isolated full-project run', () => {
		const checkout = createCheckerClone();
		try {
			const result = spawnSync(
				testExecutable('bun'),
				[
					path.join(checkout.repository, 'scripts', 'static-checks.ts'),
					'--ci',
					'--scope',
					'format'
				],
				{
					cwd: checkout.repository,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
					encoding: 'utf8'
				}
			);
			const output = `${result.stdout}${result.stderr}`;
			expect(result.status, output).toBe(0);
			expect(output).toMatch(/prettier\s+[1-9]\d* file\(s\)/);
			expect(output).not.toContain('prettier         whole project');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 120_000);

	it.skipIf(process.platform === 'win32')(
		'rejects a full lint run whose formatter matched zero files',
		() => {
			const checkout = createCheckerClone();
			const tools = path.join(checkout.directory, 'tools');
			mkdirSync(tools);
			const misspell = path.join(tools, 'misspell');
			writeFileSync(misspell, '#!/bin/sh\nexit 0\n');
			chmodSync(misspell, 0o755);
			// The invariant under test is the ledger's real in-process Prettier classification.
			// Child commands are irrelevant after that and would turn one assertion into a full
			// lint suite, so the PATH-local Bun acknowledges them without doing duplicate work.
			const childBun = path.join(tools, 'bun');
			writeFileSync(childBun, '#!/bin/sh\nexit 0\n');
			chmodSync(childBun, 0o755);
			writeFileSync(path.join(checkout.repository, '.prettierignore'), '**/*\n');
			try {
				const env = sanitizedGitEnv();
				env.NO_COLOR = '1';
				env.PATH = `${tools}${path.delimiter}${env.PATH ?? ''}`;
				const result = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts', 'static-checks.ts'),
						'--ci',
						'--scope',
						'lint'
					],
					{ cwd: checkout.repository, env, encoding: 'utf8', timeout: 240_000 }
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toContain('Full-project run: "prettier" matched 0 files');
				expect(output).not.toContain('prettier         whole project');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		300_000
	);

	it.skipIf(process.platform === 'win32')(
		'rejects a staged file that no active lint check consumes',
		() => {
			const checkout = createCheckerClone();
			const tools = path.join(checkout.directory, 'staged-tools');
			mkdirSync(tools);
			for (const command of ['bun', 'misspell']) {
				const executable = path.join(tools, command);
				writeFileSync(executable, '#!/bin/sh\nexit 0\n');
				chmodSync(executable, 0o755);
			}
			const file = path.join(checkout.repository, 'src', 'i18n', 'repro.bin');
			writeFileSync(file, String.fromCharCode(1, 2, 3));
			const staged = spawnSync('git', ['add', '--', 'src/i18n/repro.bin'], {
				cwd: checkout.repository,
				env: sanitizedGitEnv(),
				encoding: 'utf8'
			});
			expect(staged.status, staged.stderr).toBe(0);
			try {
				const env = sanitizedGitEnv();
				env.NO_COLOR = '1';
				env.PATH = `${tools}${path.delimiter}${env.PATH ?? ''}`;
				const result = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts', 'static-checks.ts'),
						'--staged',
						'--scope',
						'lint'
					],
					{ cwd: checkout.repository, env, encoding: 'utf8', timeout: 120_000 }
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toContain('No check in the active scope (lint) is responsible');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		180_000
	);

	it.skipIf(process.platform === 'win32')(
		'prüft ein dereferenziertes Ziel gegen denselben aktiven Index',
		() => {
			const checkout = createCheckerClone();
			const target = path.join(checkout.repository, 'scripts', 'staged-link-target.ts');
			const link = path.join(checkout.repository, 'scripts', 'staged-link.ts');
			const git = (args: string[]) =>
				spawnSync('git', args, {
					cwd: checkout.repository,
					env: sanitizedGitEnv(),
					encoding: 'utf8'
				});
			try {
				writeFileSync(target, 'export const stagedTarget = 1;\n');
				expect(git(['add', '--', 'scripts/staged-link-target.ts']).status).toBe(0);
				expect(
					git([
						'-c',
						'user.name=Probe',
						'-c',
						'user.email=probe@example.com',
						'commit',
						'--quiet',
						'--no-gpg-sign',
						'--no-verify',
						'-m',
						'Staged link fixture'
					]).status
				).toBe(0);
				symlinkSync('staged-link-target.ts', link);
				expect(git(['add', '--', 'scripts/staged-link.ts']).status).toBe(0);
				writeFileSync(target, 'export const stagedTarget = 2;\n');

				const result = spawnSync(
					testExecutable('bun'),
					[checkout.repository + '/scripts/static-checks.ts', '--staged', '--scope', 'lint'],
					{
						cwd: checkout.repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
						encoding: 'utf8'
					}
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toContain('Staged file contents differ from the worktree');
				expect(output).not.toContain('SvelteKit sync');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		120_000
	);

	it.skipIf(process.platform === 'win32')(
		'verlangt jedes Glied einer staged Linkkette aus demselben aktiven Index',
		() => {
			const checkout = createCheckerClone();
			const targetRelative = 'scripts/staged-chain-target.ts';
			const middleRelative = 'scripts/staged-chain-middle.ts';
			const outerRelative = 'scripts/staged-chain-outer.ts';
			const target = path.join(checkout.repository, targetRelative);
			const middle = path.join(checkout.repository, middleRelative);
			const outer = path.join(checkout.repository, outerRelative);
			try {
				git(checkout.repository, ['config', 'user.email', 'test@example.com']);
				git(checkout.repository, ['config', 'user.name', 'Test']);
				git(checkout.repository, ['config', 'commit.gpgsign', 'false']);
				writeFileSync(target, 'export const stagedChainTarget = 1;\n');
				git(checkout.repository, ['add', targetRelative]);
				git(checkout.repository, ['commit', '-qm', 'Staged chain target']);
				symlinkSync(path.basename(target), middle);
				symlinkSync(path.basename(middle), outer);
				git(checkout.repository, ['add', outerRelative]);

				const tools = path.join(checkout.directory, 'staged-chain-tools');
				mkdirSync(tools);
				for (const command of ['bun', 'misspell']) {
					const executable = path.join(tools, command);
					writeFileSync(executable, '#!/bin/sh\nexit 0\n');
					chmodSync(executable, 0o755);
				}
				const env = {
					...sanitizedGitEnv(),
					NO_COLOR: '1',
					PATH: `${tools}${path.delimiter}${process.env.PATH ?? ''}`
				};
				const runStaged = (runEnv = env) => {
					const result = spawnSync(
						testExecutable('bun'),
						[
							path.join(checkout.repository, 'scripts/static-checks.ts'),
							'--staged',
							'--scope',
							'lint'
						],
						{ cwd: checkout.repository, env: runEnv, encoding: 'utf8' }
					);
					return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
				};

				const missing = runStaged();
				git(checkout.repository, ['add', middleRelative]);
				const complete = runStaged();
				const alternativeIndex = path.join(checkout.directory, 'staged-chain-index');
				copyFileSync(path.join(checkout.repository, '.git', 'index'), alternativeIndex);
				const alternative = runStaged({
					...env,
					GIT_INDEX_FILE: alternativeIndex,
					STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX: '1'
				});

				const output = [missing.output, complete.output, alternative.output].join(
					'\n--- RUN ---\n'
				);
				expect([missing.status, complete.status, alternative.status], output).toEqual([1, 0, 0]);
				expect(missing.output).toContain(middleRelative);
				expect(missing.output).toContain('absent from the active Git index');
				expect(missing.output).not.toContain('SvelteKit sync');
				expect(complete.output).toContain('All checks passed');
				expect(alternative.output).toContain('All checks passed');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		180_000
	);

	it.skipIf(process.platform === 'win32')(
		'accepts a deletion-only staged change after validating the final index',
		() => {
			const checkout = createCheckerClone();
			const tools = path.join(checkout.directory, 'deletion-tools');
			mkdirSync(tools);
			for (const command of ['bun', 'misspell']) {
				const executable = path.join(tools, command);
				writeFileSync(executable, '#!/bin/sh\nexit 0\n');
				chmodSync(executable, 0o755);
			}
			const relative = 'scripts/deletion-probe.md';
			writeFileSync(path.join(checkout.repository, relative), '# delete me\n');
			const git = (args: string[]) =>
				spawnSync('git', args, {
					cwd: checkout.repository,
					env: sanitizedGitEnv(),
					encoding: 'utf8'
				});
			expect(git(['add', '--', relative]).status).toBe(0);
			expect(
				git([
					'-c',
					'user.name=Probe',
					'-c',
					'user.email=probe@example.com',
					'commit',
					'--quiet',
					'--no-gpg-sign',
					'--no-verify',
					'-m',
					'Deletion fixture'
				]).status
			).toBe(0);
			expect(git(['rm', '--quiet', '--', relative]).status).toBe(0);
			try {
				const env = sanitizedGitEnv();
				env.NO_COLOR = '1';
				env.PATH = `${tools}${path.delimiter}${env.PATH ?? ''}`;
				const result = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts', 'static-checks.ts'),
						'--staged',
						'--scope',
						'lint'
					],
					{ cwd: checkout.repository, env, encoding: 'utf8', timeout: 120_000 }
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(0);
				expect(output).toContain(
					'NO WORK: staged changes only delete paths absent from the final index.'
				);
				expect(output).toContain('All checks passed');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		180_000
	);

	it.skipIf(process.platform === 'win32')(
		'rejects an index-only deletion whose worktree configuration remains active',
		() => {
			const checkout = createCheckerClone();
			const tools = path.join(checkout.directory, 'cached-delete-tools');
			mkdirSync(tools);
			for (const command of ['bun', 'misspell']) {
				const executable = path.join(tools, command);
				writeFileSync(executable, '#!/bin/sh\nexit 0\n');
				chmodSync(executable, 0o755);
			}
			const git = (args: string[]) =>
				spawnSync('git', args, {
					cwd: checkout.repository,
					env: sanitizedGitEnv(),
					encoding: 'utf8'
				});
			expect(git(['rm', '--cached', '--quiet', '.prettierignore']).status).toBe(0);
			writeFileSync(path.join(checkout.repository, '.prettierignore'), 'static/repro.json\n');
			const repro = path.join(checkout.repository, 'static', 'repro.json');
			writeFileSync(repro, '{"value":1}\n');
			expect(git(['add', '--', 'static/repro.json']).status).toBe(0);
			try {
				const env = sanitizedGitEnv();
				env.NO_COLOR = '1';
				env.PATH = `${tools}${path.delimiter}${env.PATH ?? ''}`;
				const result = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts', 'static-checks.ts'),
						'--staged',
						'--scope',
						'lint'
					],
					{ cwd: checkout.repository, env, encoding: 'utf8', timeout: 120_000 }
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toContain('Staged file contents differ from the worktree');
				expect(output).not.toContain('All checks passed');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		180_000
	);

	// The staged gate ends by proving the checked bytes are still the staged bytes, and
	// that argument belongs to the lint-and-types path. A format scope leaves through its
	// own early exit, so the combination is refused rather than given a second closing.
	it('refuses a staged format run instead of exiting past the staged closing argument', () => {
		const result = spawnSync(testExecutable('bun'), [SCRIPT, '--staged', '--scope', 'format'], {
			cwd: ROOT,
			env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
			encoding: 'utf8'
		});
		const output = `${result.stdout}${result.stderr}`;
		expect(result.status).toBe(1);
		expect(output).toContain('--scope format does not support --staged');
		// The diagnostic must not send a staged gate to `--files-from`: that names paths, and
		// every checker then reads the working tree, so a file staged unformatted and then
		// formatted only on disk would pass the gate and be committed unformatted.
		expect(output).toContain('always as the files are on disk');
		expect(output).not.toContain('use --files-from');
		expect(output).not.toContain('Code formatting');
	});

	// A locale file is Prettier's and nothing else's: no type check, no lint route. The
	// checker still has to know that, or a `--scope types` over one sees a file no check
	// covers and fails a run whose only covering check is legitimately switched off.
	it('recognizes suppressed formatter work in a type-scoped run over a locale file', () => {
		const result = spawnSync(
			testExecutable('bun'),
			[SCRIPT, '--ci', '--scope', 'types', 'src/i18n/en.json'],
			{ cwd: ROOT, env: { ...sanitizedGitEnv(), NO_COLOR: '1' }, encoding: 'utf8' }
		);
		const output = `${result.stdout}${result.stderr}`;
		expect(output).toContain('every check covering them is switched off');
		expect(output).not.toContain('no check ran over any of them');
		expect(result.status).toBe(0);
	}, 120_000);
});
