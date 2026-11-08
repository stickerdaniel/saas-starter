import { describe, expect, it } from 'vitest';
import { normalizeSupportAppVersion } from './support-app-version';

describe('normalizeSupportAppVersion', () => {
	it.each([
		[
			'a commit SHA',
			'97107cb818c17d49d5686089e38ad10e51724934',
			'97107cb818c17d49d5686089e38ad10e51724934'
		],
		['the local build name', 'dev', 'dev'],
		['the longest accepted name', 'v'.repeat(64), 'v'.repeat(64)],
		['a name past the bound', 'v'.repeat(65), undefined],
		['a name with a slash', 'feature/x', undefined],
		['a name with brackets', 'build[1]', undefined],
		['a name with a space', 'dev build', undefined],
		['a name with a newline', 'dev\n', undefined],
		['an empty name', '', undefined],
		['no name', undefined, undefined]
	])('maps %s', (_case, value, expected) => {
		expect(normalizeSupportAppVersion(value)).toBe(expected);
	});
});
