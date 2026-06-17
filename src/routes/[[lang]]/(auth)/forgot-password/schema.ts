import * as v from 'valibot';
import { emailSchema } from '$lib/schemas/auth';

// Forgot Password Schema
export const forgotPasswordSchema = v.object({
	email: emailSchema
});

// Types
export type ForgotPasswordData = v.InferOutput<typeof forgotPasswordSchema>;
