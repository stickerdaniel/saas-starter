import * as v from 'valibot';
import {
	PASSWORD_MIN_LENGTH,
	passwordValidation,
	passwordRequired
} from '$lib/schemas/password.js';

// Re-export for backward compatibility
export { PASSWORD_MIN_LENGTH };

// Sign In Schema
export const signInSchema = v.object({
	email: v.pipe(v.string(), v.email('validation.email.invalid')),
	_password: passwordRequired
});

// Sign Up Schema
export const signUpSchema = v.object({
	name: v.pipe(v.string(), v.nonEmpty('validation.name.required')),
	email: v.pipe(v.string(), v.email('validation.email.invalid')),
	_password: passwordValidation
});

// Types
export type SignInData = v.InferOutput<typeof signInSchema>;
export type SignUpData = v.InferOutput<typeof signUpSchema>;
