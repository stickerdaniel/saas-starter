import {
	Forbidden,
	Invalid,
	isRetryable,
	NotFound,
	RateLimited,
	TransportLost,
	Unauthenticated,
	Upstream
} from './errors';
import { describe, expect, it } from './vitest';

describe('shared errors', () => {
	it.each([
		[new TransportLost({ cause: new Error('socket closed') }), true],
		[new RateLimited({ retryAfter: 1_000 }), true],
		[new Unauthenticated(), false],
		[new Forbidden({ code: 'ADMIN_ACCESS_REQUIRED' }), false],
		[new NotFound({ code: 'USER_NOT_FOUND' }), false],
		[new Invalid({ code: 'BAD_INPUT' }), false],
		[new Upstream({ service: 'resend', cause: new Error('500') }), false],
		[new Error('untagged'), false],
		['untagged', false]
	])('isRetryable(%s) is %s', (error, retryable) => {
		expect(isRetryable(error)).toBe(retryable);
	});
});
