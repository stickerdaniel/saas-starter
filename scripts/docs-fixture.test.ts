import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureSite, restoring } from './docs-fixture';

const SET = 'DOCS_FIXTURE_TEST_SET';
const UNSET = 'DOCS_FIXTURE_TEST_UNSET';

function contents(dir: string): Record<string, string> {
	return Object.fromEntries(
		fs
			.readdirSync(dir, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => {
				const file = path.join(entry.parentPath, entry.name);
				return [path.relative(dir, file).split(path.sep).join('/'), fs.readFileSync(file, 'utf8')];
			})
	);
}

describe('restoring', () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
		delete process.env[SET];
		delete process.env[UNSET];
	});

	it('gives back the variables and the files of a directory when the work throws', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-fixture-restoring-'));
		dirs.push(dir);
		fs.mkdirSync(path.join(dir, 'types'));
		fs.writeFileSync(path.join(dir, 'tsconfig.json'), 'ordinary config');
		fs.writeFileSync(path.join(dir, 'types', 'index.d.ts'), 'ordinary types');
		process.env[SET] = 'earlier';

		const work = restoring([SET, UNSET], dir, async () => {
			process.env[SET] = 'fixture';
			process.env[UNSET] = 'fixture';
			fs.writeFileSync(path.join(dir, 'tsconfig.json'), 'fixture config');
			fs.rmSync(path.join(dir, 'types', 'index.d.ts'));
			fs.mkdirSync(path.join(dir, 'added'));
			fs.writeFileSync(path.join(dir, 'added', 'partial.d.ts'), 'partial');
			fs.writeFileSync(path.join(dir, 'types', 'extra.d.ts'), 'extra');
			throw new Error('the build failed');
		});

		await expect(work).rejects.toThrow('the build failed');
		expect(process.env[SET]).toBe('earlier');
		expect(Object.hasOwn(process.env, UNSET)).toBe(false);
		expect(contents(dir)).toEqual({
			'tsconfig.json': 'ordinary config',
			'types/index.d.ts': 'ordinary types'
		});
	});
});

describe('fixtureSite', () => {
	it('falls back to the fixture origin when the site variables are empty', () => {
		expect(fixtureSite({ PUBLIC_SITE_URL: '', SITE_URL: '' })).toBe('http://localhost:4173');
		expect(fixtureSite({ SITE_URL: '' })).toBe('http://localhost:4173');
	});

	it('keeps a configured site origin', () => {
		expect(fixtureSite({ SITE_URL: 'https://app.example.com' })).toBe('https://app.example.com');
	});
});
