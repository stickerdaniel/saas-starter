import * as v from 'valibot';

// Forgot Password Schema
export const forgotPasswordSchema = v.object({
	email: v.pipe(v.string(), v.email('Please enter a valid email.'))
});

// Types
export type ForgotPasswordData = v.InferOutput<typeof forgotPasswordSchema>;
