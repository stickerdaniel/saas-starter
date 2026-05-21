import { describe, expect, it } from 'vitest';
import { sanitizeBranchAlias } from './platform';

describe('sanitizeBranchAlias', () => {
	it('uses the full alias budget for short worker names', () => {
		const workerName = 'myapp'; // 5 chars, budget 57
		const longBranch = 'a'.repeat(80);
		const alias = sanitizeBranchAlias(longBranch, workerName);
		expect(alias.length).toBe(57);
		expect(`${alias}-${workerName}`.length).toBeLessThanOrEqual(63);
	});

	it('shrinks alias budget for long worker names', () => {
		const workerName = 'my-cool-saas-product'; // 20 chars, budget 42
		const longBranch = 'a'.repeat(80);
		const alias = sanitizeBranchAlias(longBranch, workerName);
		expect(alias.length).toBe(42);
		expect(`${alias}-${workerName}`.length).toBeLessThanOrEqual(63);
	});

	it('keeps digit-leading branches valid even with long worker names', () => {
		const workerName = 'my-cool-saas-product'; // 20 chars, budget 42
		const alias = sanitizeBranchAlias('123-feature-branch', workerName);
		expect(alias.startsWith('b-1')).toBe(true);
		expect(alias).toMatch(/^[a-z]/);
		expect(`${alias}-${workerName}`.length).toBeLessThanOrEqual(63);
	});

	it('falls back to "branch" for an empty branch name', () => {
		expect(sanitizeBranchAlias('', 'myapp')).toBe('branch');
	});

	it('falls back to "branch" for an all-punctuation branch name', () => {
		expect(sanitizeBranchAlias('---', 'myapp')).toBe('branch');
	});

	it('throws when the worker name leaves a budget below the fallback length', () => {
		const tooLong = 'a'.repeat(57); // budget = 5, fallback "branch" is 6
		expect(() => sanitizeBranchAlias('feature', tooLong)).toThrow(/leaves only 5 chars/);
	});

	it('accepts a worker name that leaves a budget exactly equal to the fallback length', () => {
		const justFits = 'a'.repeat(56); // budget = 6, exactly fits "branch"
		expect(sanitizeBranchAlias('', justFits)).toBe('branch');
	});

	it('trims trailing dash introduced by truncation', () => {
		const workerName = 'myapp';
		// 56-char branch ending with chars that will keep a dash at slice boundary
		const branch = 'a'.repeat(56) + '-tail';
		const alias = sanitizeBranchAlias(branch, workerName);
		expect(alias.endsWith('-')).toBe(false);
	});
});
