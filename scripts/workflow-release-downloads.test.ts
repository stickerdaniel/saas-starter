import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const GITHUB_DIR = resolve(import.meta.dirname, '../.github');

// The github.com release link is served to anonymous clients, and GitHub has
// answered it with 502, 503 and 504 for over an hour while throttling that
// traffic. The API asset endpoint, called with the job token, kept serving.
const ANONYMOUS_RELEASE_LINK = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/releases\/download\//;

describe('workflow release downloads', () => {
	it('fetch release assets through the authenticated API, never the github.com link', async () => {
		const files = (await readdir(GITHUB_DIR, { recursive: true })).filter((path) =>
			/\.ya?ml$/.test(path)
		);
		expect(files.length).toBeGreaterThan(0);

		const offenders: string[] = [];
		for (const file of files) {
			const lines = (await readFile(resolve(GITHUB_DIR, file), 'utf8')).split('\n');
			lines.forEach((line, index) => {
				if (ANONYMOUS_RELEASE_LINK.test(line)) offenders.push(`.github/${file}:${index + 1}`);
			});
		}
		expect(offenders).toEqual([]);
	});
});
