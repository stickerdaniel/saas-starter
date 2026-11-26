import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deletePathSets, reduceManifest } from './export-profile';

const manifestText = readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8');

describe('reduceManifest', () => {
	it('returns the manifest unchanged when no set is removed', () => {
		expect(reduceManifest(manifestText, [])).toBe(manifestText);
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

	it('deletes the files of the set, their emptied directories and nothing else', () => {
		tree = mkdtempSync(join(tmpdir(), 'export-profile-'));
		const files = [
			'e2e/utils/auth.ts',
			'node_modules/pkg/index.test.ts',
			'src/lib/confect/emails/queries.spec.ts',
			'src/lib/effect/clock.test.ts',
			'src/lib/effect/clock.ts',
			'src/lib/components/test-fixtures/StreamdownOverlayHarness.svelte'
		];
		for (const file of files) {
			mkdirSync(dirname(join(tree, file)), { recursive: true });
			writeFileSync(join(tree, file), '');
		}

		expect(deletePathSets(tree, ['tests'])).toEqual([
			'e2e/utils/auth.ts',
			'src/lib/effect/clock.test.ts'
		]);
		expect(files.filter((file) => existsSync(join(tree, file)))).toEqual([
			'node_modules/pkg/index.test.ts',
			'src/lib/confect/emails/queries.spec.ts',
			'src/lib/effect/clock.ts',
			'src/lib/components/test-fixtures/StreamdownOverlayHarness.svelte'
		]);
		expect(existsSync(join(tree, 'e2e'))).toBe(false);
	});
});
