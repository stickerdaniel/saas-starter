import * as v from 'valibot';

// Password validation constants
export const PASSWORD_MIN_LENGTH = 10;

// Change Password Schema
export const changePasswordSchema = v.pipe(
	v.object({
		_currentPassword: v.pipe(v.string(), v.nonEmpty('Please enter your current password.')),
		_newPassword: v.pipe(
			v.string(),
			v.minLength(
				PASSWORD_MIN_LENGTH,
				`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
			),
			v.regex(/[A-Z]/, 'Password must contain at least one uppercase letter.'),
			v.regex(/[a-z]/, 'Password must contain at least one lowercase letter.'),
			v.regex(/[0-9]/, 'Password must contain at least one number.')
		),
		_confirmPassword: v.pipe(v.string(), v.nonEmpty('Please confirm your new password.')),
		revokeOtherSessions: v.optional(v.boolean(), true)
	}),
	v.forward(
		v.partialCheck(
			[['_newPassword'], ['_confirmPassword']],
			(input) => input._newPassword === input._confirmPassword,
			'Passwords do not match.'
		),
		['_confirmPassword']
	)
);

// Types
export type ChangePasswordData = v.InferOutput<typeof changePasswordSchema>;
