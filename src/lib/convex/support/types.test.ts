import { describe, expect, it } from 'vitest';
import { createRateLimitError } from './types';

describe('createRateLimitError', () => {
	it('exposes stable retry metadata without product copy', () => {
		const error = createRateLimitError(1_250);

		expect(error.data).toEqual({ code: 'RATE_LIMITED', retryAfter: 1_250 });
		expect(error.data).not.toHaveProperty('message');
	});
});
