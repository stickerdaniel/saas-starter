import * as v from 'valibot';
import {
	PASSWORD_MIN_LENGTH,
	passwordValidation,
	passwordRequired,
	confirmPasswordRequired,
	PASSWORD_MISMATCH_KEY
} from '$lib/schemas/password.js';

// Re-export for backward compatibility
export { PASSWORD_MIN_LENGTH };

// Change Password Schema
export const changePasswordSchema = v.pipe(
	v.object({
		_currentPassword: passwordRequired,
		_newPassword: passwordValidation,
		_confirmPassword: confirmPasswordRequired,
		revokeOtherSessions: v.optional(v.boolean(), true)
	}),
	v.forward(
		v.partialCheck(
			[['_newPassword'], ['_confirmPassword']],
			(input) => input._newPassword === input._confirmPassword,
			PASSWORD_MISMATCH_KEY
		),
		['_confirmPassword']
	)
);

// Set Password Schema
//
// An account created through an OAuth provider has no credential account and so
// no current password to verify. It therefore cannot reuse changePasswordSchema,
// whose _currentPassword is required and would fail validation before the
// request is ever made. There is no revokeOtherSessions here either: Better
// Auth's setPassword body carries only newPassword, and a first password has no
// earlier password-authenticated session to sign out.
export const setPasswordSchema = v.pipe(
	v.object({
		_newPassword: passwordValidation,
		_confirmPassword: confirmPasswordRequired
	}),
	v.forward(
		v.partialCheck(
			[['_newPassword'], ['_confirmPassword']],
			(input) => input._newPassword === input._confirmPassword,
			PASSWORD_MISMATCH_KEY
		),
		['_confirmPassword']
	)
);

// Types
export type ChangePasswordData = v.InferOutput<typeof changePasswordSchema>;
export type SetPasswordData = v.InferOutput<typeof setPasswordSchema>;
