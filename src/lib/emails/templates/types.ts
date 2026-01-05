import type { ComponentProps } from 'svelte';
import type VerificationEmail from './VerificationEmail.svelte';
import type PasswordResetEmail from './PasswordResetEmail.svelte';
import type AdminReplyNotificationEmail from './AdminReplyNotificationEmail.svelte';

// Extract component prop types
export type VerificationEmailProps = ComponentProps<typeof VerificationEmail>;
export type PasswordResetEmailProps = ComponentProps<typeof PasswordResetEmail>;
export type AdminReplyNotificationEmailProps = ComponentProps<typeof AdminReplyNotificationEmail>;

// Helper to make all props required (removes optional defaults)
type RequiredProps<T> = {
	[K in keyof T]-?: T[K];
};

/**
 * Runtime data types for email rendering functions
 * These define what data you pass to the render functions in templates.ts
 */

/**
 * Data required to render a verification email
 * @property code - 8-digit verification code
 * @property expiryMinutes - Minutes until the code expires
 */
export type VerificationEmailData = {
	code: string;
	expiryMinutes: number;
};

/**
 * Data required to render a password reset email
 * @property resetUrl - URL to the password reset page with token
 * @property userName - User's name for personalization (optional, defaults to "there")
 */
export type PasswordResetEmailData = {
	resetUrl: string;
	userName?: string;
};

/**
 * Data required to render an admin reply notification email
 * @property adminName - Name of the admin who replied
 * @property messagePreview - Preview text of the admin's message
 * @property deepLink - URL to view the full conversation
 */
export type AdminReplyNotificationEmailData = {
	adminName: string;
	messagePreview: string;
	deepLink: string;
};

/**
 * Common return type for all email render functions
 */
export type RenderedEmail = {
	html: string;
	text: string;
};
