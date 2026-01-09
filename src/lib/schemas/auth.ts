import { z } from 'zod';

// Email validation schema (reusable across the app)
export const emailSchema = z.string().email();

// Password validation constants
export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
	.string()
	.min(PASSWORD_MIN_LENGTH, 'auth.errors.password_min_length')
	.regex(/[A-Z]/, 'auth.errors.password_uppercase')
	.regex(/[a-z]/, 'auth.errors.password_lowercase')
	.regex(/[0-9]/, 'auth.errors.password_number');

// URL params schema (for signin/signup tabs)
export const authParamsSchema = z.object({
	tab: z.enum(['signin', 'signup']).default('signin'),
	redirectTo: z.string().default('')
});

// Form schemas
export const signInSchema = z.object({
	email: z.string().email('auth.errors.invalid_email'),
	password: z.string().min(1, 'auth.errors.password_required')
});

export const signUpSchema = z.object({
	name: z.string().min(1, 'auth.errors.name_required'),
	email: z.string().email('auth.errors.invalid_email'),
	password: passwordSchema
});

export const forgotPasswordSchema = z.object({
	email: z.string().email('auth.errors.invalid_email')
});

export const resetPasswordSchema = z.object({
	password: passwordSchema,
	confirmPassword: z.string().min(1, 'auth.errors.confirm_password_required')
});

export const changePasswordSchema = z.object({
	currentPassword: z.string().min(1, 'auth.errors.current_password_required'),
	newPassword: passwordSchema,
	confirmPassword: z.string().min(1, 'auth.errors.confirm_password_required'),
	revokeOtherSessions: z.boolean().default(true)
});

export const changeEmailSchema = z.object({
	newEmail: z.string().email('auth.errors.invalid_email')
});

// Helper to validate password confirmation (use in form handlers)
export function validatePasswordMatch(password: string, confirmPassword: string): string | null {
	if (password !== confirmPassword) {
		return 'auth.errors.passwords_do_not_match';
	}
	return null;
}

// Types
export type AuthParams = z.infer<typeof authParamsSchema>;
export type SignInSchema = typeof signInSchema;
export type SignUpSchema = typeof signUpSchema;
export type ForgotPasswordSchema = typeof forgotPasswordSchema;
export type ResetPasswordSchema = typeof resetPasswordSchema;
export type ChangePasswordSchema = typeof changePasswordSchema;
export type ChangeEmailSchema = typeof changeEmailSchema;
