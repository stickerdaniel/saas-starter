import { describe, expect, it } from 'vitest';
import { categoriesFor, classify } from './list-upstream-changes';

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
		expect(categoriesFor(['src/i18n/en.json'])).toEqual(['i18n']);
		expect(categoriesFor(['src/routes/layout.css'])).toEqual(['theme']);
		expect(categoriesFor(['.github/workflows/ci.yml'])).toEqual(['env/deploy']);
		expect(categoriesFor(['src/lib/convex/schema.ts'])).toEqual(['backend']);
		expect(categoriesFor(['e2e/login.spec.ts'])).toEqual(['tests']);
		expect(categoriesFor(['package.json'])).toEqual(['config']);
		expect(categoriesFor(['src/lib/config/legal.ts'])).toEqual(['branding']);
	});

	it('returns multiple distinct categories and none for unrelated files', () => {
		const cats = categoriesFor(['src/i18n/de.json', 'src/lib/convex/auth.ts', 'README.md']);
		expect(cats).toContain('i18n');
		expect(cats).toContain('backend');
		expect(cats).toHaveLength(2);
		expect(categoriesFor(['src/lib/components/Button.svelte'])).toEqual([]);
	});
});
