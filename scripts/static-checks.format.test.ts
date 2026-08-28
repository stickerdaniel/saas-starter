import { spawnSync } from 'child_process';
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { sanitizedGitEnv } from './git-context';
import {
	prettierArguments,
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

function createCheckerClone(): { directory: string; repository: string } {
	const directory = path.join(ROOT, 'scratch', `format-ledger-${process.pid}-${Date.now()}`);
	const repository = path.join(directory, 'repository');
	mkdirSync(directory, { recursive: true });
	try {
		const result = spawnSync(
			'git',
			['clone', '--quiet', '--local', '--no-hardlinks', ROOT, repository],
			{ env: sanitizedGitEnv(), encoding: 'utf8' }
		);
		if (result.status !== 0) throw new Error(`Local checker clone failed: ${result.stderr}`);
		symlinkSync(
			path.join(ROOT, 'node_modules'),
			path.join(repository, 'node_modules'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		copyFileSync(SCRIPT, path.join(repository, 'scripts', 'static-checks.ts'));
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

	it('documents a Git producer that excludes deleted paths', () => {
		const source = readFileSync(SCRIPT, 'utf8');
		expect(source).toContain('git diff --name-only --diff-filter=d -z');
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
	it('keeps abandoned checker clones out of project-wide checks', () => {
		const vite = readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
		const eslint = readFileSync(path.join(ROOT, 'eslint.config.js'), 'utf8');
		const oxlint = readFileSync(path.join(ROOT, '.oxlintrc.json'), 'utf8');
		expect(vite).toContain("'scratch/**'");
		expect(eslint).toContain("'scratch/**'");
		expect(oxlint).toContain('"scratch/**"');
	});

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
		expect(output).toContain('--files-from');
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
