import * as v from 'valibot';

// Password validation constants
export const PASSWORD_MIN_LENGTH = 10;

// Sign In Schema
export const signInSchema = v.object({
	email: v.pipe(v.string(), v.email('Please enter a valid email.')),
	_password: v.pipe(v.string(), v.nonEmpty('Please enter your password.'))
});

// Sign Up Schema
export const signUpSchema = v.object({
	name: v.pipe(v.string(), v.nonEmpty('Please enter your name.')),
	email: v.pipe(v.string(), v.email('Please enter a valid email.')),
	_password: v.pipe(
		v.string(),
		v.minLength(
			PASSWORD_MIN_LENGTH,
			`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
		),
		v.regex(/[A-Z]/, 'Password must contain at least one uppercase letter.'),
		v.regex(/[a-z]/, 'Password must contain at least one lowercase letter.'),
		v.regex(/[0-9]/, 'Password must contain at least one number.')
	)
});

// Types
export type SignInData = v.InferOutput<typeof signInSchema>;
export type SignUpData = v.InferOutput<typeof signUpSchema>;
