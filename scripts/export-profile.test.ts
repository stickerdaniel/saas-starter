import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deletePathSets, reduceManifest } from './export-profile';

const manifestText = readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8');

describe('reduceManifest', () => {
	it('returns the text unchanged when no set is removed, whatever its formatting', () => {
		const compact = '{"scripts":{"test":"vitest"},"devDependencies":{}}';
		expect(reduceManifest(compact, [])).toBe(compact);
	});

	it('runs only the remaining suites and drops the dependencies only the tests used', () => {
		const full = JSON.parse(manifestText);
		const reduced = JSON.parse(reduceManifest(manifestText, ['tests']));

		expect(reduced.scripts.test).toBe(
			'bun run test:unit && bun run check:table-scroll && bun run test:cli && bun run check:streamdown-overlay'
		);
		expect(Object.keys(full.scripts).filter((name) => !(name in reduced.scripts))).toEqual([
			'check:reduced-export',
			'test:e2e',
			'test:e2e:headed',
			'test:bun',
			'test:upstream-report'
		]);
		expect(
			Object.keys(full.devDependencies).filter((name) => !(name in reduced.devDependencies))
		).toEqual([
			'@axe-core/playwright',
			'@sentry/core',
			'dom-accessibility-api',
			'miniflare',
			'strip-ansi',
			'tinyglobby'
		]);
		expect(reduced.dependencies).toEqual(full.dependencies);
	});
});

describe('deletePathSets', () => {
	let tree = '';
	afterEach(() => rmSync(tree, { recursive: true, force: true }));

	it('deletes the listed files of the set and their emptied directories, and keeps every other file', () => {
		tree = mkdtempSync(join(tmpdir(), 'export-profile-'));
		const tracked = [
			'e2e/utils/auth.ts',
			'src/lib/confect/emails/queries.spec.ts',
			'src/lib/effect/clock.test.ts',
			'src/lib/effect/clock.ts',
			'src/lib/components/test-fixtures/StreamdownOverlayHarness.svelte'
		];
		const ignored = ['e2e/.auth/session.json', 'test-results/trace.test.ts'];
		for (const file of [...tracked, ...ignored]) {
			mkdirSync(dirname(join(tree, file)), { recursive: true });
			writeFileSync(join(tree, file), '');
		}

		expect(deletePathSets(tree, tracked, ['tests'])).toEqual([
			'e2e/utils/auth.ts',
			'src/lib/effect/clock.test.ts'
		]);
		expect([...tracked, ...ignored].filter((file) => existsSync(join(tree, file)))).toEqual([
			'src/lib/confect/emails/queries.spec.ts',
			'src/lib/effect/clock.ts',
			'src/lib/components/test-fixtures/StreamdownOverlayHarness.svelte',
			...ignored
		]);
		expect(existsSync(join(tree, 'e2e/utils'))).toBe(false);
	});
});
