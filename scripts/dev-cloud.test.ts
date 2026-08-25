import { describe, expect, it } from 'vitest';
import { runUntilOneExits } from './dev-cloud';

describe('runUntilOneExits', () => {
	it('returns the first exit code and terminates the sibling process', async () => {
		const started = Date.now();
		const code = await runUntilOneExits(
			[
				{ command: process.execPath, args: ['-e', 'setTimeout(() => process.exit(7), 25)'] },
				{ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }
			],
			'ignore'
		);

		expect(code).toBe(7);
		expect(Date.now() - started).toBeLessThan(2_000);
	});
});
