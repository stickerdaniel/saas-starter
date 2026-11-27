import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deletePathSets, reduceManifest } from './export-profile';
import { FLAT_TREE } from './path-sets';

const manifestText = readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8');

interface Manifest {
	scripts: Record<string, string>;
	devDependencies: Record<string, string>;
}

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
			'check:docs-fixture',
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

	it.each<[string, (full: Manifest) => Manifest, string]>([
		[
			'whose suite scripts were renamed',
			(full) => {
				const { 'test:e2e': e2e = '', ...scripts } = full.scripts;
				return { ...full, scripts: { ...scripts, 'ci:e2e': e2e } };
			},
			'it names the scripts ["check:docs-fixture","check:reduced-export","test:bun","test:e2e:headed","test:upstream-report"] and the devDependencies ["@axe-core/playwright","@sentry/core","dom-accessibility-api","miniflare","strip-ansi","tinyglobby"]'
		],
		[
			'that is reduced but has miniflare back',
			(full) => {
				const reduced: Manifest = JSON.parse(reduceManifest(JSON.stringify(full), ['tests']));
				return {
					...reduced,
					devDependencies: { ...reduced.devDependencies, miniflare: '^4.0.0' }
				};
			},
			'it names the scripts [] and the devDependencies ["miniflare"]'
		]
	])('throws for a manifest %s', (_, shape, names) => {
		const text = JSON.stringify(shape(JSON.parse(manifestText)));

		expect(() => reduceManifest(text, ['tests'])).toThrow(
			`package.json is neither full nor reduced for the tests set: ${names}`
		);
	});

	it('returns a manifest without the suite scripts and dependencies as it is', () => {
		const reduced = reduceManifest(manifestText, ['tests']);
		const compact = JSON.stringify(JSON.parse(reduced));

		expect(reduceManifest(compact, ['tests'])).toBe(compact);
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

		expect(deletePathSets(tree, tracked, ['tests'], FLAT_TREE)).toEqual([
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

	it('skips a listed file that is gone and keeps an empty directory it did not empty', () => {
		tree = mkdtempSync(join(tmpdir(), 'export-profile-'));
		const tracked = [
			'e2e/public-a11y.spec.ts',
			'e2e/utils/auth.ts',
			'packages/create-saas-starter/test/target.test.ts',
			'scripts/__fixtures__/static-checks/private-checkout.ts'
		];
		mkdirSync(join(tree, 'e2e/utils'), { recursive: true });
		writeFileSync(join(tree, 'e2e/utils/auth.ts'), '');
		mkdirSync(join(tree, 'scripts/__fixtures__/static-checks'), { recursive: true });

		expect(deletePathSets(tree, tracked, ['tests'], FLAT_TREE)).toEqual(['e2e/utils/auth.ts']);
		expect(deletePathSets(tree, tracked, ['tests'], FLAT_TREE)).toEqual([]);
		expect(
			['e2e', 'scripts/__fixtures__/static-checks'].filter((path) => existsSync(join(tree, path)))
		).toEqual(['scripts/__fixtures__/static-checks']);
	});

	it('keeps an empty e2e directory when its only listed file is already gone', () => {
		tree = mkdtempSync(join(tmpdir(), 'export-profile-'));
		mkdirSync(join(tree, 'e2e'));

		expect(deletePathSets(tree, ['e2e/public-a11y.spec.ts'], ['tests'], FLAT_TREE)).toEqual([]);
		expect(existsSync(join(tree, 'e2e'))).toBe(true);
	});

	it('deletes nothing and throws when an ancestor of a listed file is a link', () => {
		tree = mkdtempSync(join(tmpdir(), 'export-profile-'));
		const outside = mkdtempSync(join(tmpdir(), 'export-profile-outside-'));
		try {
			writeFileSync(join(outside, 'public.spec.ts'), 'outside');
			mkdirSync(join(tree, 'app'));
			writeFileSync(join(tree, 'app/app.test.ts'), '');
			symlinkSync(outside, join(tree, 'e2e'), process.platform === 'win32' ? 'junction' : 'dir');

			expect(() =>
				deletePathSets(tree, ['app/app.test.ts', 'e2e/public.spec.ts'], ['tests'], FLAT_TREE)
			).toThrow('Could not delete e2e/public.spec.ts: its ancestor e2e is no directory');
			expect(existsSync(join(outside, 'public.spec.ts'))).toBe(true);
			expect(existsSync(join(tree, 'app/app.test.ts'))).toBe(true);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it('deletes nothing and throws when a listed path is no regular file', () => {
		tree = mkdtempSync(join(tmpdir(), 'export-profile-'));
		mkdirSync(join(tree, 'e2e/utils'), { recursive: true });
		writeFileSync(join(tree, 'e2e/a.spec.ts'), '');

		expect(() =>
			deletePathSets(tree, ['e2e/a.spec.ts', 'e2e/utils'], ['tests'], FLAT_TREE)
		).toThrow('Could not delete e2e/utils: it is no regular file');
		expect(existsSync(join(tree, 'e2e/a.spec.ts'))).toBe(true);
	});
});
