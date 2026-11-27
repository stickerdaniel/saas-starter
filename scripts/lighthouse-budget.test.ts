import { describe, expect, it } from 'vitest';
import {
	breaches,
	canChangeLanding,
	median,
	summarize,
	type FormFactorBudget,
	type Sample
} from './lighthouse-budget';

const sample = (score: number, fcp: number, cls = 0): Sample => ({
	score,
	metrics: {
		'first-contentful-paint': fcp,
		'largest-contentful-paint': fcp + 50,
		'total-blocking-time': 5,
		'cumulative-layout-shift': cls,
		'speed-index': 600
	}
});

const BUDGET: FormFactorBudget = {
	minScore: 99,
	max: {
		'first-contentful-paint': 500,
		'largest-contentful-paint': 550,
		'total-blocking-time': 50,
		'cumulative-layout-shift': 0.01,
		'speed-index': 1000
	}
};

describe('median', () => {
	it('takes the middle of an unsorted odd count and the mean of the middle pair otherwise', () => {
		expect(median([620, 352, 9000, 340, 387])).toBe(387);
		expect(median([4, 1, 3, 2])).toBe(2.5);
	});

	it('rejects an empty list', () => {
		expect(() => median([])).toThrow();
	});
});

describe('budget comparison', () => {
	it('passes medians at the limits even when one run breaches', () => {
		const runs = [sample(100, 350), sample(99, 500, 0.01), sample(97, 900, 0.0138)];
		expect(breaches(summarize(runs), BUDGET)).toEqual([]);
	});

	it('names each median beyond its limit', () => {
		const runs = [sample(98, 600), sample(97, 610), sample(100, 340)];
		expect(breaches(summarize(runs), BUDGET)).toEqual([
			'score 98 < 99',
			'FCP 600 ms > 500 ms',
			'LCP 650 ms > 550 ms'
		]);
	});
});

describe('canChangeLanding', () => {
	it('skips changes confined to docs, tests, fixtures and other workflows', () => {
		expect(
			canChangeLanding([
				'docs/decisions/x.md',
				'README.md',
				'scripts/AGENTS.md',
				'e2e/landing.spec.ts',
				'src/lib/foo.test.ts',
				'src/lib/convex/users.test.ts',
				'scripts/__fixtures__/test-fixtures/a.json',
				'.github/workflows/static-checks.yml'
			])
		).toBe(false);
	});

	it('audits app sources, Markdown under src, styles and the audit workflow', () => {
		for (const file of [
			'src/routes/layout.css',
			'src/lib/content/about.md',
			'package.json',
			'scripts/lighthouse-budget.ts',
			'lighthouse-budget.json',
			'.github/workflows/e2e-preview-cf.yml'
		])
			expect(canChangeLanding(['docs/x.md', file])).toBe(true);
	});
});
