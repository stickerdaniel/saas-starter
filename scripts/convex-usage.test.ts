import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDENS_DIR } from '../src/lib/confect/goldens';
import { specInventory } from './convex-goldens';
import { countsAsUsage, type Source, unusedFunctions } from './convex-unused-functions';

const checkout = path.resolve(import.meta.dirname, '..');

function projectSources(root: string): Source[] {
	return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024
	})
		.split('\0')
		.filter((file) => file !== '' && countsAsUsage(file))
		.filter((file) => existsSync(path.join(root, file)))
		.map((file) => ({ file, source: readFileSync(path.join(root, file), 'utf8') }));
}

describe('Convex function usage across the checkout', () => {
	it('match the committed list of functions nothing in the app calls', async () => {
		const known: unknown = JSON.parse(
			readFileSync(path.join(checkout, GOLDENS_DIR, 'unused-functions.json'), 'utf8')
		);

		expect(unusedFunctions(await specInventory(checkout), projectSources(checkout))).toEqual(known);
	});
});
