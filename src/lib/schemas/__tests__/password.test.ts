import { describe, it, expect } from 'vitest';
import * as v from 'valibot';
import {
	PASSWORD_MIN_LENGTH,
	passwordValidation,
	passwordRequired,
	confirmPasswordRequired,
	PASSWORD_MISMATCH_KEY
} from '../password';

describe('PASSWORD_MIN_LENGTH', () => {
	it('has expected value of 10', () => {
		expect(PASSWORD_MIN_LENGTH).toBe(10);
	});
});

describe('passwordValidation', () => {
	it('accepts valid passwords meeting all requirements', () => {
		const validPasswords = ['Password123', 'MySecure1Pass', 'Test12345A', 'Abcdefgh1Z'];

		for (const password of validPasswords) {
			const result = v.safeParse(passwordValidation, password);
			expect(result.success, `Password "${password}" should be valid`).toBe(true);
		}
	});

	it('rejects passwords shorter than minimum length', () => {
		const result = v.safeParse(passwordValidation, 'Pass123'); // 7 chars
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.password.min_length')).toBe(true);
		}
	});

	it('rejects passwords without uppercase letter', () => {
		const result = v.safeParse(passwordValidation, 'password123'); // no uppercase
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.password.uppercase')).toBe(true);
		}
	});

	it('rejects passwords without lowercase letter', () => {
		const result = v.safeParse(passwordValidation, 'PASSWORD123'); // no lowercase
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.password.lowercase')).toBe(true);
		}
	});

	it('rejects passwords without number', () => {
		const result = v.safeParse(passwordValidation, 'PasswordABC'); // no number
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.password.number')).toBe(true);
		}
	});

	it('rejects empty passwords with all validation errors', () => {
		const result = v.safeParse(passwordValidation, '');
		expect(result.success).toBe(false);
	});

	it('validates exactly at minimum length boundary', () => {
		// Exactly 10 characters with all requirements
		const result = v.safeParse(passwordValidation, 'Abcdefgh1Z');
		expect(result.success).toBe(true);
	});
});

describe('passwordRequired', () => {
	it('accepts non-empty passwords without complexity check', () => {
		const result = v.safeParse(passwordRequired, 'simple');
		expect(result.success).toBe(true);
	});

	it('rejects empty passwords', () => {
		const result = v.safeParse(passwordRequired, '');
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0].message).toBe('validation.password.required');
		}
	});
});

describe('confirmPasswordRequired', () => {
	it('accepts non-empty confirm password', () => {
		const result = v.safeParse(confirmPasswordRequired, 'anyvalue');
		expect(result.success).toBe(true);
	});

	it('rejects empty confirm password', () => {
		const result = v.safeParse(confirmPasswordRequired, '');
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0].message).toBe('validation.confirm_password.required');
		}
	});
});

describe('PASSWORD_MISMATCH_KEY', () => {
	it('has expected translation key', () => {
		expect(PASSWORD_MISMATCH_KEY).toBe('validation.confirm_password.mismatch');
	});
});
