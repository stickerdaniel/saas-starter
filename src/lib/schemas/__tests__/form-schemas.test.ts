import { describe, it, expect } from 'vitest';
import * as v from 'valibot';
import { signInSchema, signUpSchema } from '../../../routes/[[lang]]/(auth)/signin/schema';
import { forgotPasswordSchema } from '../../../routes/[[lang]]/(auth)/forgot-password/schema';
import { resetPasswordSchema } from '../../../routes/[[lang]]/(auth)/reset-password/schema';
import { changeEmailSchema } from '../../../routes/[[lang]]/app/settings/email-schema';
import {
	changePasswordSchema,
	setPasswordSchema
} from '../../../routes/[[lang]]/app/settings/password-schema';

describe('signInSchema', () => {
	it('accepts valid email and password', () => {
		const result = v.safeParse(signInSchema, {
			email: 'test@example.com',
			_password: 'anypassword'
		});
		expect(result.success).toBe(true);
	});

	it('rejects invalid email', () => {
		const result = v.safeParse(signInSchema, {
			email: 'notanemail',
			_password: 'password'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.email.invalid')).toBe(true);
		}
	});

	it('rejects empty password', () => {
		const result = v.safeParse(signInSchema, {
			email: 'test@example.com',
			_password: ''
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.password.required')).toBe(true);
		}
	});
});

describe('signUpSchema', () => {
	it('accepts valid signup data', () => {
		const result = v.safeParse(signUpSchema, {
			name: 'John Doe',
			email: 'john@example.com',
			_password: 'Password123'
		});
		expect(result.success).toBe(true);
	});

	it('rejects empty name', () => {
		const result = v.safeParse(signUpSchema, {
			name: '',
			email: 'john@example.com',
			_password: 'Password123'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.name.required')).toBe(true);
		}
	});

	it('rejects weak password (no uppercase)', () => {
		const result = v.safeParse(signUpSchema, {
			name: 'John Doe',
			email: 'john@example.com',
			_password: 'password123'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.password.uppercase')).toBe(true);
		}
	});
});

describe('forgotPasswordSchema', () => {
	it('accepts valid email', () => {
		const result = v.safeParse(forgotPasswordSchema, {
			email: 'test@example.com'
		});
		expect(result.success).toBe(true);
	});

	it('rejects invalid email', () => {
		const result = v.safeParse(forgotPasswordSchema, {
			email: 'invalid'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.email.invalid')).toBe(true);
		}
	});
});

describe('resetPasswordSchema', () => {
	it('accepts matching valid passwords', () => {
		const result = v.safeParse(resetPasswordSchema, {
			_password: 'Password123',
			_confirmPassword: 'Password123'
		});
		expect(result.success).toBe(true);
	});

	it('rejects mismatched passwords', () => {
		const result = v.safeParse(resetPasswordSchema, {
			_password: 'Password123',
			_confirmPassword: 'Password456'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.confirm_password.mismatch')).toBe(
				true
			);
		}
	});

	it('rejects weak password', () => {
		const result = v.safeParse(resetPasswordSchema, {
			_password: 'weak',
			_confirmPassword: 'weak'
		});
		expect(result.success).toBe(false);
	});
});

describe('changeEmailSchema', () => {
	it('accepts valid new email', () => {
		const result = v.safeParse(changeEmailSchema, {
			newEmail: 'newemail@example.com'
		});
		expect(result.success).toBe(true);
	});

	it('rejects invalid email', () => {
		const result = v.safeParse(changeEmailSchema, {
			newEmail: 'notvalid'
		});
		expect(result.success).toBe(false);
	});
});

describe('changePasswordSchema', () => {
	it('accepts valid password change data', () => {
		const result = v.safeParse(changePasswordSchema, {
			_currentPassword: 'currentpass',
			_newPassword: 'NewPassword123',
			_confirmPassword: 'NewPassword123',
			revokeOtherSessions: true
		});
		expect(result.success).toBe(true);
	});

	it('rejects mismatched new passwords', () => {
		const result = v.safeParse(changePasswordSchema, {
			_currentPassword: 'currentpass',
			_newPassword: 'NewPassword123',
			_confirmPassword: 'DifferentPassword123',
			revokeOtherSessions: true
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.confirm_password.mismatch')).toBe(
				true
			);
		}
	});

	it('rejects weak new password', () => {
		const result = v.safeParse(changePasswordSchema, {
			_currentPassword: 'currentpass',
			_newPassword: 'weakpass',
			_confirmPassword: 'weakpass',
			revokeOtherSessions: false
		});
		expect(result.success).toBe(false);
	});
});

describe('setPasswordSchema', () => {
	it('accepts a first password without a current one', () => {
		const result = v.safeParse(setPasswordSchema, {
			_newPassword: 'NewPassword123',
			_confirmPassword: 'NewPassword123'
		});
		expect(result.success).toBe(true);
	});

	it('rejects mismatched passwords', () => {
		const result = v.safeParse(setPasswordSchema, {
			_newPassword: 'NewPassword123',
			_confirmPassword: 'DifferentPassword123'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === 'validation.confirm_password.mismatch')).toBe(
				true
			);
		}
	});

	// Each candidate is long enough to clear the length rule, so the rule under
	// test is the one named. A single short password would fail all three and the
	// test would stay green after the complexity rules were removed.
	it.each([
		['validation.password.uppercase', 'lowercase1'],
		['validation.password.lowercase', 'UPPERCASE1'],
		['validation.password.number', 'NoDigitsHere']
	])('applies %s, the same strength rule as a password change', (message, password) => {
		const result = v.safeParse(setPasswordSchema, {
			_newPassword: password,
			_confirmPassword: password
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message === message)).toBe(true);
		}
	});

	// The account this form serves has no password, so requiring a current one
	// would make it unsubmittable. changePasswordSchema must keep requiring it.
	it('does not require a current password, unlike changePasswordSchema', () => {
		const body = { _newPassword: 'NewPassword123', _confirmPassword: 'NewPassword123' };
		expect(v.safeParse(setPasswordSchema, body).success).toBe(true);
		expect(v.safeParse(changePasswordSchema, body).success).toBe(false);
	});
});
