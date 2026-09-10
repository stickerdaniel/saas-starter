import { describe, expect, it } from 'vitest';
import { ConvexError } from 'convex/values';
import { getConvexErrorCode, getConvexErrorData } from '../convex-errors';

describe('structured Convex error parsing', () => {
	it('reads safe structured data and its stable code', () => {
		const error = new ConvexError({ code: 'known_code', retryAfter: 5000 });

		expect(getConvexErrorData(error)).toEqual({ code: 'known_code', retryAfter: 5000 });
		expect(getConvexErrorCode(error)).toBe('known_code');
	});

	it('accepts the serialized ConvexError shape used across boundaries', () => {
		const error = { data: { code: 'serialized_code' } };

		expect(getConvexErrorCode(error)).toBe('serialized_code');
	});

	it('does not treat string data or generated messages as protocol', () => {
		expect(getConvexErrorData(new ConvexError('legacy message'))).toBeUndefined();
		expect(getConvexErrorCode(new Error('known_code'))).toBeUndefined();
	});
});
