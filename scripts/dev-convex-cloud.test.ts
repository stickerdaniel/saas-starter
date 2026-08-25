import { describe, expect, it } from 'vitest';
import { convexDevCommand } from './dev-convex-cloud';

describe('convexDevCommand', () => {
	it('forwards Convex CLI arguments', () => {
		expect(convexDevCommand(['--once', '--typecheck', 'disable'])).toEqual([
			'convex',
			'dev',
			'--once',
			'--typecheck',
			'disable'
		]);
	});
});
