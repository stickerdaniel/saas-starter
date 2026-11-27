import { describe, expect, it } from 'vitest';
import {
	categoriesFor,
	changeSide,
	changeSides,
	classify,
	isExcluded,
	isOmittedOnly
} from './list-upstream-changes';

const flat = (...paths: string[]) => paths.map((path) => changeSide(path, 'flat'));

describe('classify', () => {
	it('tags explicit security signals', () => {
		expect(
			classify('chore(deps): update vite to v8.0.16 [security] (#579)', 'renovate[bot]').priority
		).toBe('security');
		expect(classify('fix: patch CVE-2025-1234 in parser', 'a').priority).toBe('security');
		expect(classify('fix(forms): prevent SQL injection', 'a').priority).toBe('security');
		expect(classify('fix(auth): revoke sessions on reset', 'a').priority).toBe('security');
		expect(classify('fix(ui): sanitize untrusted markdown', 'a').priority).toBe('security');
		expect(classify('fix: close an auth bypass on admin routes', 'a').priority).toBe('security');
		// secret/credential handling stays tagged (review-all: missing it is worse than an early look)
		expect(classify('ci(workflows): harden token and secret handling', 'a').priority).toBe(
			'security'
		);
	});

	it('does NOT over-tag the common phrase "dependency injection"', () => {
		// the real false positive the qualifier fix removes
		expect(classify('feat: add dependency injection container', 'a').priority).toBe('feat');
		expect(classify('refactor: tidy the injection wiring', 'a').priority).toBe('refactor');
	});

	it('derives the conventional type and non-security priority', () => {
		expect(classify('feat(home): new hero', 'a')).toEqual({ priority: 'feat', type: 'feat' });
		expect(classify('fix(ui): button radius', 'a')).toEqual({ priority: 'fix', type: 'fix' });
		expect(classify('refactor(convex): tidy', 'a')).toEqual({
			priority: 'refactor',
			type: 'refactor'
		});
		expect(classify('chore(deps): bump x', 'a').priority).toBe('chore');
	});

	it('treats renovate/dependabot non-security bumps as chore', () => {
		expect(classify('fix(deps): update all non-major dependencies', 'renovate[bot]').priority).toBe(
			'chore'
		);
	});

	it('falls back to type "other" without a conventional prefix', () => {
		expect(classify('Sunray backdrop on marketing subpages', 'a')).toEqual({
			priority: 'other',
			type: 'other'
		});
	});
});

describe('categoriesFor', () => {
	it('maps paths to divergence categories', () => {
		expect(categoriesFor(flat('src/i18n/en.json'))).toEqual(['i18n']);
		expect(categoriesFor(flat('src/routes/layout.css'))).toEqual(['theme']);
		expect(categoriesFor(flat('.github/workflows/ci.yml'))).toEqual(['env/deploy']);
		expect(categoriesFor(flat('src/lib/convex/schema.ts'))).toEqual(['backend']);
		expect(categoriesFor(flat('src/lib/confect/functions.ts'))).toEqual(['backend']);
		expect(categoriesFor(flat('src/lib/convex-components/betterAuth/adapter.ts'))).toEqual([
			'backend'
		]);
		expect(categoriesFor(flat('e2e/login.spec.ts'))).toEqual(['tests']);
		expect(categoriesFor(flat('package.json'))).toEqual(['config']);
		expect(categoriesFor(flat('src/lib/config/legal.ts'))).toEqual(['branding']);
	});

	it('labels a Confect declaration as backend and a Confect test as a test', () => {
		expect(categoriesFor(flat('src/lib/confect/admin/auditLog/queries.spec.ts'))).toEqual([
			'backend'
		]);
		expect(categoriesFor(flat('src/lib/confect/admin/auditLog/queries.test.ts'))).toEqual([
			'backend',
			'tests'
		]);
	});

	it('returns multiple distinct categories and none for unrelated files', () => {
		const cats = categoriesFor(flat('src/i18n/de.json', 'src/lib/convex/auth.ts', 'README.md'));
		expect(cats).toContain('i18n');
		expect(cats).toContain('backend');
		expect(cats).toHaveLength(2);
		expect(categoriesFor(flat('src/lib/components/Button.svelte'))).toEqual([]);
	});
});

describe('a change across the move', () => {
	const layouts = { parent: 'flat', commit: 'workspace' } as const;
	const renamed = (from: string, to: string) =>
		changeSides({ status: 'R100', paths: [from, to] }, layouts);

	it('keeps a renamed Confect declaration out of the tests on both sides', () => {
		const sides = renamed('src/lib/confect/x.spec.ts', 'packages/backend/confect/x.spec.ts');

		expect(sides.map(({ path, layout, owner }) => [path, layout, owner])).toEqual([
			['src/lib/confect/x.spec.ts', 'flat', 'root'],
			['packages/backend/confect/x.spec.ts', 'workspace', 'backend']
		]);
		expect(sides.map((side) => categoriesFor([side]))).toEqual([['backend'], ['backend']]);
		expect(isOmittedOnly(sides, ['tests'])).toBe(false);
	});

	it('counts a renamed test as a test on both sides', () => {
		const sides = renamed('src/lib/x.test.ts', 'apps/web/src/lib/x.test.ts');

		expect(sides.map((side) => categoriesFor([side]))).toEqual([['tests'], ['tests']]);
		expect(isOmittedOnly(sides, ['tests'])).toBe(true);
	});

	it('reads an added path at the commit and a deleted path at the parent', () => {
		expect(changeSides({ status: 'A', paths: ['packages/ui/x.spec.ts'] }, layouts)).toEqual([
			changeSide('packages/ui/x.spec.ts', 'workspace')
		]);
		expect(changeSides({ status: 'D', paths: ['src/lib/confect/x.spec.ts'] }, layouts)).toEqual([
			changeSide('src/lib/confect/x.spec.ts', 'flat')
		]);
	});
});

describe('isExcluded', () => {
	const full = '93b54c246f0e1d2c3b4a5968778695a4b3c2d1e0';

	it('matches entries recorded while git printed shorter or longer SHAs', () => {
		expect(isExcluded(full, ['93b54c24'])).toBe(true);
		expect(isExcluded(full, ['93b54c246'])).toBe(true);
		expect(isExcluded(full, [full.toUpperCase()])).toBe(true);
	});

	it('ignores other commits and prefixes too short to identify one', () => {
		expect(isExcluded(full, ['93b54c25'])).toBe(false);
		expect(isExcluded(full, ['93b54c'])).toBe(false);
		expect(isExcluded(full, [])).toBe(false);
	});
});
