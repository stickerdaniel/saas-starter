import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	collectFindings,
	formatFindings,
	inventory,
	isMissing,
	shouldScanContents,
	scanFile,
	scannableFiles,
	type SourceSafetyFinding
} from './source-safety';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every forbidden character is constructed, never typed. A fixture spelling one out
// would put the banned byte into the file that bans it, and the scan covers its own
// test the same as any other source file.
const ch = (code: number) => String.fromCharCode(code);
const ESC = ch(0x1b);

const codepoints = (findings: SourceSafetyFinding[]) =>
	findings.flatMap((finding) => (finding.kind === 'character' ? [finding.codepoint] : []));

let repo: string;

/** A throwaway tree, so the scan can be measured without touching this repository. */
function write(file: string, contents: string | Uint8Array): void {
	const target = path.join(repo, file);
	mkdirSync(path.dirname(target), { recursive: true });
	writeFileSync(target, contents);
}

beforeAll(() => {
	repo = mkdtempSync(path.join(tmpdir(), 'source-safety-'));
	write('.gitignore', 'ignored/\n');
	write('ignored/secret.ts', 'export const a = 1;\n');
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('the scanned file set', () => {
	it('includes files regardless of repository ignore rules', () => {
		write('ordinary.ts', 'export const value = 1;\n');

		const files = inventory(repo);

		expect(files).toContain('ordinary.ts');
		expect(files).toContain('ignored/secret.ts');
	});

	it('skips root output directories without hiding an ordinary nested source directory', () => {
		write('build/root-output.ts', 'export const output = 1;\n');
		write('src/build/source.ts', 'export const source = 1;\n');

		const files = inventory(repo);

		expect(files).not.toContain('build/root-output.ts');
		expect(files).toContain('src/build/source.ts');
	});

	it('ignores only a disappeared directory entry', () => {
		expect(isMissing(Object.assign(new Error('gone'), { code: 'ENOENT' }))).toBe(true);
		expect(isMissing(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(false);
	});

	it('drops duplicates and sorts, so a named file is not reported twice', () => {
		expect(scannableFiles(['b.ts', 'a.ts', 'b.ts'])).toEqual(['a.ts', 'b.ts']);
	});

	it('scans source formats and exempts only known opaque or generated contents', () => {
		expect(shouldScanContents('src/app.ts')).toBe(true);
		expect(shouldScanContents('docs/readme.md')).toBe(true);
		expect(shouldScanContents('wrangler.toml')).toBe(true);
		expect(shouldScanContents('src/other.test.ts.snap')).toBe(true);
		expect(shouldScanContents('static/pixel.bmp')).toBe(false);
		expect(
			shouldScanContents('src/lib/emails/__tests__/__snapshots__/email-snapshots.test.ts.snap')
		).toBe(false);
	});

	// The exclusion above is only sound while Prettier refuses to parse a snapshot. It
	// pads inbox preview text with bidi marks, so the day Prettier starts reading .snap
	// is the day the exclusion becomes a hole, and this is what says so.
	it('keeps the snapshot exclusion honest against the installed Prettier', () => {
		const result = spawnSync(
			'bun',
			[
				'prettier',
				'--file-info',
				'src/lib/emails/__tests__/__snapshots__/email-snapshots.test.ts.snap'
			],
			{ cwd: REPO_ROOT, encoding: 'utf-8' }
		);

		expect(JSON.parse(result.stdout).inferredParser).toBeNull();
	});
});

describe('what counts as a finding', () => {
	it('reports a C0 control and leaves tab, line feed and carriage return alone', async () => {
		write('c0.ts', `const a = '\t';\r\nconst b = '${ch(0x0b)}';\n`);

		const findings = await collectFindings(['c0.ts'], repo);

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({ line: 2, column: 12, codepoint: 'U+000B' });
	});

	it('covers DEL and the whole C1 range without reaching past it', async () => {
		const codes = [0x7f, 0x80, 0x9f];
		for (const code of codes) {
			write('range.ts', `const a = '${ch(code)}';\n`);
			expect(await collectFindings(['range.ts'], repo)).toHaveLength(1);
		}
		write('range.ts', `const a = '${ch(0x1f)}${ch(0x20)}${ch(0xa0)}';\n`);
		expect(codepoints(await collectFindings(['range.ts'], repo))).toEqual(['U+001F']);
	});

	it('reports every bidi control, which is what makes source read as one thing and run as another', async () => {
		const bidi = [
			0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069
		];
		write('bidi.ts', `// ${bidi.map(ch).join('')}\n`);

		const found = await collectFindings(['bidi.ts'], repo);

		expect(codepoints(found)).toEqual(
			bidi.map((c) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`)
		);
		expect(
			found.every(
				(finding) => finding.kind === 'character' && finding.category === 'bidirectional formatting'
			)
		).toBe(true);
	});

	it('accepts the escape that spells the same character', async () => {
		write('escaped.ts', "const a = '\\u001B';\n");

		expect(await collectFindings(['escaped.ts'], repo)).toEqual([]);
	});

	it('reads a path as source too, because every diagnostic prints the file name', async () => {
		const findings = await scanFile(`weird${ESC}name.ts`, repo);

		const finding = findings.find((candidate) => candidate.kind === 'character');
		expect(finding).toMatchObject({ line: 0, codepoint: 'U+001B' });
		expect(finding!.file).toContain('U+001B');
		expect(finding!.file).not.toContain(ESC);
	});

	it('uses the stricter diagnostic policy for structure inside a file name', async () => {
		for (const code of [0x09, 0x0a, 0x0d, 0x2028, 0x2029]) {
			const findings = await scanFile(`before${ch(code)}after.ts`, repo);
			expect(codepoints(findings)).toEqual([
				`U+${code.toString(16).toUpperCase().padStart(4, '0')}`
			]);
			const finding = findings.find((candidate) => candidate.kind === 'character');
			expect(finding!.file).not.toContain(ch(code));
		}
	});

	it('checks the name even when generated contents are exempt', async () => {
		const generated = `src/lib/emails/generated/snapshot${ESC}.ts`;
		write(generated, `intentional ${ch(0x200e)} padding`);

		const findings = await scanFile(generated, repo);

		expect(codepoints(findings)).toEqual(['U+001B']);
	});
});

describe('what the scan refuses to guess about', () => {
	it('skips contents whose file extension marks them as binary', async () => {
		write('logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]));

		expect(await collectFindings(['logo.png'], repo)).toEqual([]);
	});

	// NUL takes a file out of code review because git stops diffing it as text. A source
	// extension keeps the file on the text path, so NUL cannot masquerade as binary data.
	it('still reports a NUL in a text file instead of calling the file binary', async () => {
		write('nul.ts', `const key = 'a${ch(0x00)}b';\n`);

		expect(codepoints(await collectFindings(['nul.ts'], repo))).toEqual(['U+0000']);
	});

	it('fails a source file whose UTF-8 cannot be decoded instead of treating it as binary', async () => {
		write('invalid.ts', new Uint8Array([0x2f, 0x2f, 0x20, 0xff, 0x0a]));

		expect(await collectFindings(['invalid.ts'], repo)).toContainEqual({
			kind: 'encoding',
			file: 'invalid.ts'
		});
	});

	it('keeps a lone CR as a line break when the next character is in another chunk', async () => {
		write('streamed.ts', `${'a'.repeat(65_535)}${ch(0x0d)}${ESC}`);

		const findings = await collectFindings(['streamed.ts'], repo);

		expect(findings).toContainEqual(
			expect.objectContaining({ kind: 'character', line: 2, column: 1, codepoint: 'U+001B' })
		);
	});

	it('counts a CRLF split across stream chunks as one line break', async () => {
		write('streamed-crlf.ts', `${'a'.repeat(65_535)}${ch(0x0d)}${ch(0x0a)}${ESC}`);

		const findings = await collectFindings(['streamed-crlf.ts'], repo);

		expect(findings).toContainEqual(
			expect.objectContaining({ kind: 'character', line: 2, column: 1, codepoint: 'U+001B' })
		);
	});

	it('retains only the findings the bounded report can display', async () => {
		write('many.ts', new Uint8Array(1_000_000));

		const retained = await scanFile('many.ts', repo);
		const findings = await collectFindings(['many.ts'], repo);

		expect(retained).toHaveLength(21);
		expect(findings).toHaveLength(21);
		expect(findings.at(-1)).toEqual({ kind: 'omitted' });
	});

	it('says nothing about a file that is gone, which is what a staged deletion looks like', async () => {
		expect(await collectFindings(['never-existed.ts'], repo)).toEqual([]);
	});
});

describe('the report', () => {
	const finding = (line: number): SourceSafetyFinding => ({
		kind: 'character',
		file: 'src/a.ts',
		line,
		column: 1,
		codepoint: 'U+001B',
		category: 'C0 control',
		escape: '\\u001B'
	});

	it('names the codepoint and the position, and never the character', async () => {
		const [line] = formatFindings([finding(7)]);

		expect(line).toBe('src/a.ts:7:1: U+001B (C0 control)');
		expect(line).not.toContain(ESC);
	});

	it('counts the rest rather than filling the terminal with them', async () => {
		const lines = formatFindings([
			...Array.from({ length: 20 }, (_, i) => finding(i + 1)),
			{ kind: 'omitted' }
		]);

		expect(lines).toHaveLength(21);
		expect(lines.at(-1)).toBe('More findings omitted; fix these and run again');
	});
});

describe('the command boundary', () => {
	it('scans before importing the rest of the static-check implementation', () => {
		const source = readFileSync(path.join(REPO_ROOT, 'scripts/static-checks.ts'), 'utf8');
		const preflight = source.indexOf('await runSourceSafetyPreflight(REPO_ROOT)');

		expect(preflight).toBeGreaterThanOrEqual(0);
		expect(preflight).toBeLessThan(source.indexOf("import('../knowledge-policy.config')"));
		expect(source).not.toMatch(/^import .*knowledge-policy/m);
	});

	it('runs source safety before install, format, and unit-test parsers', () => {
		const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

		for (const script of ['postinstall', 'format', 'test:unit']) {
			expect(pkg.scripts[script]).toMatch(/^bun run source:safety && /);
		}
	});

	it('sanitizes a missing caller-controlled path before printing it', () => {
		const missing = `missing${ESC}]0;title${ch(0x07)}.ts`;
		const result = spawnSync('bun', ['scripts/static-checks.ts', missing], {
			cwd: REPO_ROOT,
			encoding: 'utf8'
		});
		const output = result.stdout + result.stderr;

		expect(result.status).not.toBe(0);
		expect(output).not.toContain(`${ESC}]0;title${ch(0x07)}`);
		expect(output).toContain('U+001B');
	});
});

describe('the whole run', () => {
	// Prettier builds its parse-error code frame from the original source. The fixture
	// lives in a unique directory under the repository because the runner resolves only
	// repository paths; uniqueness keeps the test from overwriting somebody's file.
	const payload = `${ESC}]0;title${ch(0x07)}`;

	it('stops before the first checker instead of letting one quote the file', async () => {
		const directory = mkdtempSync(path.join(REPO_ROOT, 'source-safety-regression-'));
		const fixture = path.relative(REPO_ROOT, path.join(directory, 'fixture.ts'));
		try {
			writeFileSync(
				path.join(REPO_ROOT, fixture),
				`// padding ${payload} here
const a = 1;
const b = ;
`,
				'utf8'
			);

			const prettier = spawnSync('bun', ['prettier', '--no-color', '--check', fixture], {
				cwd: REPO_ROOT,
				encoding: 'utf-8'
			});
			// Without a guard the sequence travels. If this ever stops holding, the guard is
			// no longer load-bearing and the reason for it should be re-argued, not deleted.
			expect(prettier.stdout + prettier.stderr).toContain(payload);

			const checks = spawnSync('bun', ['scripts/static-checks.ts', '--scope', 'lint', fixture], {
				cwd: REPO_ROOT,
				encoding: 'utf-8'
			});
			const output = checks.stdout + checks.stderr;

			expect(checks.status).not.toBe(0);
			expect(output).not.toContain(payload);
			expect(output).toContain('U+001B');
			expect(output).not.toContain('SvelteKit sync');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 60_000);

	it('fails closed when the same source also contains malformed UTF-8', async () => {
		const directory = mkdtempSync(path.join(REPO_ROOT, 'source-safety-encoding-'));
		const fixture = path.relative(REPO_ROOT, path.join(directory, 'fixture.ts'));
		try {
			writeFileSync(
				path.join(REPO_ROOT, fixture),
				Buffer.concat([
					Buffer.from(
						`// ${payload}
const a = ;
`,
						'utf8'
					),
					Buffer.from([0xff])
				])
			);

			const checks = spawnSync('bun', ['scripts/static-checks.ts', '--scope', 'lint', fixture], {
				cwd: REPO_ROOT,
				encoding: 'utf-8'
			});
			const output = checks.stdout + checks.stderr;

			expect(checks.status).not.toBe(0);
			expect(output).not.toContain(payload);
			expect(output).toContain('invalid UTF-8');
			expect(output).not.toContain('SvelteKit sync');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 60_000);
});
