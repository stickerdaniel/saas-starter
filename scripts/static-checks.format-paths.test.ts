import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { describe, expect, it, vi } from 'vitest';
import { formatChecks, repositoryFileWriter } from './__fixtures__/static-checks/format-harness';
import { usePrivateCheckout } from './__fixtures__/static-checks/private-checkout';
import { sanitizedGitEnv } from './git-context';
import {
	prettierArguments,
	prettierProjectPaths,
	prettierTraversalPaths,
	resolveInputs
} from './static-checks';
import { testExecutable } from './test-executable';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Most tests here block on real Bun and Prettier processes, so Vitest checks the budget only
// after spawnSync returns; the helpers' 10 s child timeout is the hang guard. The slowest test
// without its own budget took 5.2 s on a GitHub-hosted runner and 4.4 s on Ubicloud
// (observed 2026-10-15), so the 5 s default failed a run whose assertions all passed.
vi.setConfig({ testTimeout: 30_000 });

/** Read-only cases check the shared checkout; nothing they run writes into it. */
const { formatCheck } = formatChecks();

/** Cases that write fixtures share this private checkout and remove what they write. */
const checkout = usePrivateCheckout('static-checks-format-paths-');

/**
 * Evaluates `expression` in a child Bun where `checks` is the private checkout's own
 * static-checks module and `values` holds `values`, passed as JSON data rather than spliced
 * into the code. The module's exports resolve paths against their own repository, so an
 * in-process call would read the shared checkout instead of the fixture.
 */
function evaluateInCheckout(expression: string, values: readonly unknown[] = []): unknown {
	const { repository } = checkout();
	const module = pathToFileURL(path.join(repository, 'scripts', 'static-checks.ts')).href;
	const result = spawnSync(
		testExecutable('bun'),
		[
			'-e',
			`const [moduleUrl, encoded] = process.argv.slice(1);\nconst checks = await import(moduleUrl);\nconst values = JSON.parse(encoded);\nprocess.stdout.write(JSON.stringify(await (${expression})));`,
			module,
			JSON.stringify(values)
		],
		{
			cwd: repository,
			env: sanitizedGitEnv(),
			timeout: 10_000,
			killSignal: 'SIGKILL',
			encoding: 'utf8'
		}
	);
	if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
	return JSON.parse(result.stdout);
}

const withRepositoryFile = repositoryFileWriter(checkout);

describe('format-only static checks', () => {
	it.skipIf(process.platform === 'win32')(
		'treats an explicitly named repository symlink like the project traversal',
		() => {
			const { repository } = checkout();
			const target = `.format-link-target-${process.pid}.ts`;
			const relative = `.format-file-link-${process.pid}.ts`;
			const file = path.join(repository, relative);
			writeFileSync(path.join(repository, target), 'export const value=1\n');
			symlinkSync(target, file);
			try {
				const { status, output } = formatChecks(repository).formatCheck(file);
				expect(status).toBe(0);
				expect(output).toContain('No formatter work');
				expect(output).toContain('symbolic link');
				expect(output).toContain('prettier         0 file(s)');
				expect(output).not.toContain(target);
			} finally {
				rmSync(file, { force: true });
				rmSync(path.join(repository, target), { force: true });
			}
		}
	);

	it.skipIf(process.platform === 'win32')(
		'treats an explicitly named directory symlink like the project traversal',
		() => {
			const { repository } = checkout();
			const relative = `.format-directory-link-${process.pid}`;
			const file = path.join(repository, relative);
			symlinkSync(path.join(repository, 'scripts'), file, 'dir');
			try {
				const { status, output } = formatChecks(repository).formatCheck(file);
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
			const { repository } = checkout();
			const target = path.join(repository, 'scratch', `format-symlink-target-${process.pid}`);
			const aliasRelative = `.format-symlink-alias-${process.pid}`;
			const alias = path.join(repository, aliasRelative);
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
					cwd: repository,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
					encoding: 'utf8'
				});
				expect(direct.status, `${direct.stdout}${direct.stderr}`).toBe(1);

				expect(
					evaluateInCheckout(
						"checks.resolveInputs([values[0]], 'arguments', values[1], undefined, false)",
						[named, repository]
					)
				).toEqual([named]);

				// Directory traversal reads the resolved target, then maps every child back below
				// the alias before ignore classification and launch.
				expect(
					evaluateInCheckout(
						"checks.resolveInputs([values[0]], 'arguments', values[1], (directory) => checks.prettierTraversalPaths(directory, false, values[1]), false)",
						[namedDirectory, repository]
					)
				).toEqual([`${namedDirectory}/nested.ts`]);

				// One run covers both spellings: a dropped input is missing from Prettier's warnings,
				// while the failed-command line would still echo every argument.
				const result = formatChecks(repository).formatCheck(named, namedDirectory);
				expect(result.status, result.output).toBe(1);
				expect(result.output).toContain(`[warn] ${named}`);
				expect(result.output).toContain(`[warn] ${namedDirectory}/nested.ts`);
				expect(result.output).not.toContain('No formatter work');
			} finally {
				rmSync(alias, { force: true });
				rmSync(target, { recursive: true, force: true });
			}
		}
	);

	it.each(['.git', '.sl', '.svn', '.hg', '.jj'])(
		"counts Prettier's hard-coded %s exclusion as zero formatter work",
		(vcsDirectory) => {
			const { repository } = checkout();
			const parent = path.join(repository, 'scripts', `.format-vcs-${process.pid}`);
			const directory = path.join(parent, vcsDirectory);
			const relative = `scripts/.format-vcs-${process.pid}/${vcsDirectory}/probe.ts`;
			mkdirSync(directory, { recursive: true });
			writeFileSync(path.join(directory, 'probe.ts'), 'export const skipped   =1\n');
			try {
				// Prettier's CLI drops these path segments before expansion. `getFileInfo` does not,
				// so the classifier carries the same closed list instead of claiming this file was
				// checked when a formatted peer gives the CLI a successful match.
				const direct = spawnSync(
					testExecutable('bun'),
					['prettier', '--check', '--', relative, 'README.md'],
					{ cwd: repository, env: { ...sanitizedGitEnv(), NO_COLOR: '1' }, encoding: 'utf8' }
				);
				expect(direct.status, `${direct.stdout}${direct.stderr}`).toBe(0);
				expect(`${direct.stdout}${direct.stderr}`).not.toContain(relative);

				const result = formatChecks(repository).formatCheckFilesFrom(`${relative}\0README.md\0`);
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
			const { repository } = checkout();
			const directory = mkdtempSync(path.join(tmpdir(), 'format-checkout-alias-'));
			const alias = path.join(directory, 'repository');
			const target = path.join(repository, 'scratch', `format-alias-${process.pid}`);
			mkdirSync(target, { recursive: true });
			writeFileSync(path.join(target, 'probe.ts'), 'export const value   =1\n');
			symlinkSync(repository, alias, 'dir');
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
				const script = path.join(repository, 'scripts', 'static-checks.ts');
				const result = spawnSync(testExecutable('bun'), [script, '--scope', 'format', named], {
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
			const { repository } = checkout();
			const relative = `scripts/.format-fifo-${process.pid}.ts`;
			const file = path.join(repository, relative);
			const created = spawnSync('mkfifo', [file], { encoding: 'utf8' });
			expect(created.status, created.stderr).toBe(0);
			try {
				const result = formatChecks(repository).formatCheckFilesFrom(`${relative}\0package.json\0`);
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
			const { repository } = checkout();
			const file = path.join(repository, `.format-external-link-${process.pid}.ts`);
			writeFileSync(target, 'export const external = true;\n');
			symlinkSync(target, file);
			try {
				const { status, output } = formatChecks(repository).formatCheck(file);
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
			const { repository } = checkout();
			const invalid = Buffer.concat([Buffer.from(`${repository}/`), relative]);
			writeFileSync(invalid, 'export const value = 1;\n');
			try {
				const result = formatChecks(repository).formatCheckFilesFrom(
					Buffer.concat([relative, Buffer.from([0])])
				);
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
		const { repository } = checkout();
		const directory = `.format-local-ignore-${process.pid}`;
		const ignored = `${directory}/ignored.ts`;
		const excludesDirectory = mkdtempSync(path.join(tmpdir(), 'format-local-ignore-'));
		const excludes = path.join(excludesDirectory, 'excludes');
		const saved = new Map<string, string | undefined>();
		for (const key of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) {
			saved.set(key, process.env[key]);
		}
		mkdirSync(path.join(repository, directory));
		writeFileSync(path.join(repository, directory, 'kept.ts'), 'export const kept = true;\n');
		writeFileSync(path.join(repository, ignored), 'export const ignored    =    true;\n');
		writeFileSync(excludes, `${ignored}\n`);
		process.env.GIT_CONFIG_COUNT = '1';
		process.env.GIT_CONFIG_KEY_0 = 'core.excludesFile';
		process.env.GIT_CONFIG_VALUE_0 = excludes;
		try {
			const result = formatChecks(repository).formatCheck(path.join(repository, directory));
			expect(result.status).not.toBe(0);
			expect(result.output).toContain(`[warn] ${ignored}`);
		} finally {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			rmSync(path.join(repository, directory), { recursive: true, force: true });
			rmSync(excludesDirectory, { recursive: true, force: true });
		}
	});

	it('checks a web app manifest with the real formatter', () => {
		const relative = `format-manifest-${process.pid}.webmanifest`;
		withRepositoryFile(relative, '{"name":   "Fixture"}\n', (file) => {
			const { status, output } = formatChecks(checkout().repository).formatCheck(file);
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
		const { repository } = checkout();
		const directory = `scripts/.format-${kind}-${process.pid}`;
		const name = kind === 'babelrc' ? '.babelrc' : `README.${kind}`;
		const relative = `${directory}/${name}`;
		mkdirSync(path.join(repository, directory), { recursive: true });
		try {
			withRepositoryFile(relative, contents, (file) => {
				const { status, output } = formatChecks(repository).formatCheck(file);
				expect(status).not.toBe(0);
				expect(output).toContain(`[warn] ${relative}`);
			});
		} finally {
			rmSync(path.join(repository, directory), { recursive: true, force: true });
		}
	});

	// Prettier is the only check in a format scope, so it can answer for the whole run:
	// a file it would skip is not work anyone is owed, and saying so is honest rather
	// than a hole. The two ways to be skipped are pinned separately because they arrive
	// from different places, the parser table and the ignore files.
	it('reports an honest no-op for a file Prettier has no parser for', () => {
		const relative = `format-unknown-${process.pid}.bin`;
		withRepositoryFile(relative, 'not source\n', (file) => {
			const { status, output } = formatChecks(checkout().repository).formatCheck(file);
			expect(status).toBe(0);
			expect(output).toContain('No formatter work');
			expect(output).toContain('unknown file type');
			expect(output).not.toContain('[warn]');
		});
	});

	it('reports an honest no-op for a file the formatter ignores', () => {
		// src/varlock-env.d.ts is generated and excluded by .prettierignore, so the CLI would skip
		// it. Counting it as formatter work would report a check that never happened.
		const { status, output } = formatCheck(path.join(ROOT, 'src/varlock-env.d.ts'));
		expect(status).toBe(0);
		expect(output).toContain('No formatter work');
		expect(output).toContain('prettier         0 file(s)');
	});

	// The honest no-op above is the format scope's alone. Everywhere else, a named file
	// no check covers is still the bug it always was: src/i18n is excluded from spell
	// checking, so a binary there is routed by nothing at all. The scope is "types"
	// because a lint run ends in whole-project oxlint and knip runs, and the invariant is
	// scope-agnostic.
	it('still refuses to go green on a run no check is responsible for', () => {
		const relative = `src/i18n/format-unroutable-${process.pid}.bin`;
		withRepositoryFile(relative, '', (file) => {
			const { repository } = checkout();
			const script = path.join(repository, 'scripts', 'static-checks.ts');
			const result = spawnSync(testExecutable('bun'), [script, '--scope', 'types', file], {
				cwd: repository,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
				encoding: 'utf8'
			});
			expect(result.status).toBe(1);
			expect(`${result.stdout}${result.stderr}`).toContain('no check ran over any of them');
		});
	}, 60_000);

	it('does not reinterpret a disappeared formatter path as a glob', () => {
		const { repository } = checkout();
		const directory = `scripts/.format-glob-${process.pid}`;
		const named = `${directory}/[ab].ts`;
		const neighbour = `${directory}/a.ts`;
		mkdirSync(path.join(repository, directory), { recursive: true });
		writeFileSync(path.join(repository, named), 'export const named = true;\n');
		writeFileSync(path.join(repository, neighbour), 'export const neighbour = true;\n');
		try {
			const selected = prettierProjectPaths([named], repository, true);
			rmSync(path.join(repository, named));

			const raw = spawnSync(
				testExecutable('bun'),
				['prettier', '--check', '--ignore-unknown', '--', named],
				{ cwd: repository, env: { ...sanitizedGitEnv(), NO_COLOR: '1' }, encoding: 'utf8' }
			);
			const escaped = spawnSync(testExecutable('bun'), prettierArguments('--check', selected), {
				cwd: repository,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
				encoding: 'utf8'
			});

			expect(raw.status, `${raw.stdout}${raw.stderr}`).toBe(0);
			expect(escaped.status).not.toBe(0);
			expect(`${escaped.stdout}${escaped.stderr}`).toContain('No files matching the pattern');
		} finally {
			rmSync(path.join(repository, directory), { recursive: true, force: true });
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
			const { status, output } = formatChecks(checkout().repository).formatCheck(file);
			expect(status).not.toBe(0);
			expect(output).toContain(`[warn] ${relative}`);
			expect(output).not.toContain('outside the repository');
		});
	});
});
