import { describe, expect, it } from 'vitest';
import { cloudDevProfileCommands } from './dev-convex-cloud';

describe('cloud development capability profile', () => {
	it('sets and validates preview before starting Convex dev', () => {
		expect(cloudDevProfileCommands()).toEqual([
			['bunx', ['convex', 'env', 'set', 'CAPABILITY_PROFILE', 'preview']],
			['bun', ['scripts/validate-convex-env.ts', '--expected-profile', 'preview']]
		]);
	});
});
