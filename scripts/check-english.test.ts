import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizePolicyIdentity, proseKindForFile } from './english-policy/content';
import { MAX_INPUT_BYTES, policyIdentityForFile, readBoundedStdin } from './check-english';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/check-english.ts');
const artifactDirectory = path.join(ROOT, 'scratch', `english-policy-test-${process.pid}`);
const germanFixture = 'Das Passwort muss sofort zurückgesetzt werden.';

afterEach(() => rmSync(artifactDirectory, { recursive: true, force: true }));

describe('explicit English artifact checker', () => {
	it('checks an ignored Markdown artifact before publication', () => {
		mkdirSync(artifactDirectory, { recursive: true });
		const artifact = path.join(artifactDirectory, 'report.md');
		writeFileSync(artifact, germanFixture);
		const result = spawnSync('bun', [SCRIPT, '--artifact', artifact], {
			cwd: ROOT,
			encoding: 'utf8'
		});
		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).toContain('clear non-English prose');
	});

	it('checks an English Svelte source comment through the Bun CLI', () => {
		mkdirSync(artifactDirectory, { recursive: true });
		const artifact = path.join(artifactDirectory, 'EnglishComment.svelte');
		writeFileSync(
			artifact,
			'<script lang="ts">\n// Keep the callback destination for sign-in.\n</script>'
		);
		const result = spawnSync('bun', [SCRIPT, '--artifact', artifact], {
			cwd: ROOT,
			encoding: 'utf8'
		});
		expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
		expect(result.stdout).toContain('English policy passed for 1 input(s).');
	});

	it('reports a German Svelte source comment through the Bun CLI', () => {
		mkdirSync(artifactDirectory, { recursive: true });
		const artifact = path.join(artifactDirectory, 'GermanComment.svelte');
		writeFileSync(artifact, `<script lang="ts">\n// ${germanFixture}\n</script>`);
		const result = spawnSync('bun', [SCRIPT, '--artifact', artifact], {
			cwd: ROOT,
			encoding: 'utf8'
		});
		const output = `${result.stdout}${result.stderr}`;
		expect(result.status).toBe(1);
		expect(output).toContain('clear non-English prose');
		expect(output).not.toContain('input could not be read or validated');
	});

	it('keeps absolute repository paths tied to their policy identity', () => {
		const englishLocale = path.join(ROOT, 'src/i18n/en.json');
		const identity = policyIdentityForFile(englishLocale, ROOT);
		expect(identity).toBe('src/i18n/en.json');
		expect(proseKindForFile(identity)).toBe('english-locale');
	});

	it('normalizes Windows separators without platform-dependent path resolution', () => {
		expect(normalizePolicyIdentity('src\\i18n\\en.json')).toBe('src/i18n/en.json');
		expect(proseKindForFile(normalizePolicyIdentity('src\\i18n\\en.json'))).toBe('english-locale');
	});

	it('stops reading standard input immediately after the byte limit', () => {
		let remaining = MAX_INPUT_BYTES + 10_000;
		let readBytes = 0;
		const reader = (
			_fd: number,
			buffer: NodeJS.ArrayBufferView,
			offset: number,
			length: number
		): number => {
			const bytes = Math.min(length, remaining);
			Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).fill(
				0x61,
				offset,
				offset + bytes
			);
			remaining -= bytes;
			readBytes += bytes;
			return bytes;
		};

		expect(() => readBoundedStdin(reader)).toThrow('Input exceeds the inspection limit.');
		expect(readBytes).toBe(MAX_INPUT_BYTES + 1);
		expect(remaining).toBe(9_999);
	});

	it('checks prose supplied on standard input', () => {
		const result = spawnSync('bun', [SCRIPT, '--stdin-label', 'release-report.txt'], {
			cwd: ROOT,
			encoding: 'utf8',
			input: germanFixture
		});
		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).toContain('release-report.txt:1');
	});
});
