import * as v from 'valibot';
import { emailSchema } from '$lib/schemas/auth';
import {
	PASSWORD_MIN_LENGTH,
	passwordValidation,
	passwordRequired
} from '$lib/schemas/password.js';

// Re-export for backward compatibility
export { PASSWORD_MIN_LENGTH };

// Sign In Schema
export const signInSchema = v.object({
	email: emailSchema,
	_password: passwordRequired
});

// Sign Up Schema
export const signUpSchema = v.object({
	name: v.pipe(v.string(), v.nonEmpty('validation.name.required')),
	email: emailSchema,
	_password: passwordValidation
});

// Types
export type SignInData = v.InferOutput<typeof signInSchema>;
export type SignUpData = v.InferOutput<typeof signUpSchema>;
