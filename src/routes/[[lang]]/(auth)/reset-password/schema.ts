import * as v from 'valibot';
import {
	PASSWORD_MIN_LENGTH,
	passwordValidation,
	confirmPasswordRequired,
	PASSWORD_MISMATCH_KEY
} from '$lib/schemas/password.js';

// Re-export for backward compatibility
export { PASSWORD_MIN_LENGTH };

// Reset Password Schema
export const resetPasswordSchema = v.pipe(
	v.object({
		_password: passwordValidation,
		_confirmPassword: confirmPasswordRequired
	}),
	v.forward(
		v.partialCheck(
			[['_password'], ['_confirmPassword']],
			(input) => input._password === input._confirmPassword,
			PASSWORD_MISMATCH_KEY
		),
		['_confirmPassword']
	)
);

// Types
export type ResetPasswordData = v.InferOutput<typeof resetPasswordSchema>;
