import { describe, expect, it } from 'vitest';
import { getValidationFieldErrors } from './error-utils';

describe('admin error utils', () => {
	it('extracts field errors from convex validation envelope', () => {
		const errors = getValidationFieldErrors({
			data: {
				code: 'VALIDATION_ERROR',
				fieldErrors: {
					name: 'Required',
					budget: 'Invalid'
				}
			}
		});

		expect(errors).toEqual({
			name: 'Required',
			budget: 'Invalid'
		});
	});

	it('returns null for non-validation errors', () => {
		expect(getValidationFieldErrors(new Error('Oops'))).toBeNull();
	});
});
