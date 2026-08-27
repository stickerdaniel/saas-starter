import { spawnSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { sanitizedGitEnv } from './git-context';
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
	it('records a positive formatter match count for a full-project run', () => {
		const { status, output } = formatCheck();
		expect(status).toBe(0);
		expect(output).toMatch(/prettier\s+[1-9]\d* file\(s\)/);
		expect(output).not.toContain('prettier         whole project');
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
