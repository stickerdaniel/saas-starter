import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isUnderPreCommit, sanitizedGitEnv } from './git-context';

const SCRUBBED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'] as const;
const PRE_COMMIT_KEYS = [
	'PRE_COMMIT',
	'PRE_COMMIT_FROM_REF',
	'PRE_COMMIT_TO_REF',
	'PRE_COMMIT_HOME'
];

describe('sanitizedGitEnv', () => {
	const saved = new Map<string, string | undefined>();

	beforeEach(() => {
		for (const key of SCRUBBED) saved.set(key, process.env[key]);
	});

	afterEach(() => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		saved.clear();
	});

	it('removes all four scrubbed git env vars', () => {
		for (const key of SCRUBBED) process.env[key] = 'parent-value';
		const env = sanitizedGitEnv();
		for (const key of SCRUBBED) {
			expect(env[key]).toBeUndefined();
		}
	});

	it('preserves other env vars', () => {
		process.env['GIT_DIR'] = '/parent/.git';
		process.env['MY_UNRELATED_VAR'] = 'keep-me';
		const env = sanitizedGitEnv();
		expect(env['GIT_DIR']).toBeUndefined();
		expect(env['MY_UNRELATED_VAR']).toBe('keep-me');
		delete process.env['MY_UNRELATED_VAR'];
	});

	it('returns a copy, does not mutate process.env', () => {
		process.env['GIT_DIR'] = '/parent/.git';
		sanitizedGitEnv();
		expect(process.env['GIT_DIR']).toBe('/parent/.git');
	});
});

describe('isUnderPreCommit', () => {
	const saved = new Map<string, string | undefined>();

	beforeEach(() => {
		for (const key of [...SCRUBBED, ...PRE_COMMIT_KEYS]) saved.set(key, process.env[key]);
		for (const key of [...SCRUBBED, ...PRE_COMMIT_KEYS]) delete process.env[key];
	});

	afterEach(() => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		saved.clear();
	});

	it('returns false when no relevant env vars are set', () => {
		expect(isUnderPreCommit()).toBe(false);
	});

	it('returns false when only GIT_DIR is set (git itself sets this for every hook)', () => {
		process.env['GIT_DIR'] = '/parent/.git';
		expect(isUnderPreCommit()).toBe(false);
	});

	it('returns true when PRE_COMMIT is set', () => {
		process.env['PRE_COMMIT'] = '1';
		expect(isUnderPreCommit()).toBe(true);
	});

	it('returns true when any PRE_COMMIT_* var is set', () => {
		process.env['PRE_COMMIT_FROM_REF'] = 'abc123';
		expect(isUnderPreCommit()).toBe(true);
	});
});
