import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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
