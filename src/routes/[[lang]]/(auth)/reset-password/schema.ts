import * as v from 'valibot';

// Password validation constants
export const PASSWORD_MIN_LENGTH = 10;

// Reset Password Schema
export const resetPasswordSchema = v.pipe(
	v.object({
		_password: v.pipe(
			v.string(),
			v.minLength(
				PASSWORD_MIN_LENGTH,
				`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
			),
			v.regex(/[A-Z]/, 'Password must contain at least one uppercase letter.'),
			v.regex(/[a-z]/, 'Password must contain at least one lowercase letter.'),
			v.regex(/[0-9]/, 'Password must contain at least one number.')
		),
		_confirmPassword: v.pipe(v.string(), v.nonEmpty('Please confirm your password.'))
	}),
	v.forward(
		v.partialCheck(
			[['_password'], ['_confirmPassword']],
			(input) => input._password === input._confirmPassword,
			'Passwords do not match.'
		),
		['_confirmPassword']
	)
);

// Types
export type ResetPasswordData = v.InferOutput<typeof resetPasswordSchema>;
