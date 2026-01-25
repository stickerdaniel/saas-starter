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

// Types
export type ChangePasswordData = v.InferOutput<typeof changePasswordSchema>;
