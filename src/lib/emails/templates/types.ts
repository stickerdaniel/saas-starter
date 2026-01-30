import type { ComponentProps } from 'svelte';
import type VerificationEmail from './VerificationEmail.svelte';
import type VerificationCodeEmail from './VerificationCodeEmail.svelte';
import type PasswordResetEmail from './PasswordResetEmail.svelte';
import type AdminReplyNotificationEmail from './AdminReplyNotificationEmail.svelte';
import type NewTicketAdminNotificationEmail from './NewTicketAdminNotificationEmail.svelte';
import type NewUserSignupNotificationEmail from './NewUserSignupNotificationEmail.svelte';

// Extract component prop types
export type VerificationEmailProps = ComponentProps<typeof VerificationEmail>;
export type VerificationCodeEmailProps = ComponentProps<typeof VerificationCodeEmail>;
export type PasswordResetEmailProps = ComponentProps<typeof PasswordResetEmail>;
export type AdminReplyNotificationEmailProps = ComponentProps<typeof AdminReplyNotificationEmail>;
export type NewTicketAdminNotificationEmailProps = ComponentProps<
	typeof NewTicketAdminNotificationEmail
>;
export type NewUserSignupNotificationEmailProps = ComponentProps<
	typeof NewUserSignupNotificationEmail
>;

// Helper to make all props required (removes optional defaults)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type RequiredProps<T> = {
	[K in keyof T]-?: T[K];
};

/**
 * Runtime data types for email rendering functions
 * These define what data you pass to the render functions in templates.ts
 */

/**
 * Data required to render a verification email (magic link)
 * @property verificationUrl - URL to verify email
 * @property expiryMinutes - Minutes until the link expires
 */
export type VerificationEmailData = {
	verificationUrl: string;
	expiryMinutes: number;
};

/**
 * Data required to render a verification code email (OTP)
 * @property code - 8-digit verification code
 * @property expiryMinutes - Minutes until the code expires
 */
export type VerificationCodeEmailData = {
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
 * Message data for new ticket admin notification
 *
 * @property text - Message text (truncated to 500 chars max)
 * @property timestamp - Formatted timestamp string for display (e.g., "Jan 15, 10:30 AM")
 */
export type NotificationMessage = {
	text: string;
	timestamp: string;
};

/**
 * Data required to render a new ticket admin notification email
 *
 * Sent to admins when:
 * - User clicks "Talk to human" (handoff from AI)
 * - User sends message to a handed-off ticket
 * - User reopens a closed ticket
 *
 * @property isReopen - Whether this is a reopened ticket (true) or new/handoff ticket (false)
 * @property userName - User's name or "Anonymous" for anonymous users
 * @property messages - Array of messages to include in the notification
 * @property adminDashboardLink - Link to the admin dashboard for this thread
 */
export type NewTicketAdminNotificationEmailData = {
	isReopen: boolean;
	userName: string;
	messages: NotificationMessage[];
	adminDashboardLink: string;
};

/**
 * Data required to render a new user signup notification email
 *
 * Sent to admins when a new user registers on the platform.
 *
 * @property userName - User's display name or "New User" if not provided
 * @property userEmail - User's email address
 * @property signupMethod - How the user signed up ('Email', 'Google', 'GitHub')
 * @property signupTime - Formatted timestamp of when the user signed up
 * @property adminDashboardLink - Link to the admin users page filtered by this user
 */
export type NewUserSignupNotificationEmailData = {
	userName: string;
	userEmail: string;
	signupMethod: 'Email' | 'Google' | 'GitHub';
	signupTime: string;
	adminDashboardLink: string;
};

/**
 * Common return type for all email render functions
 */
export type RenderedEmail = {
	html: string;
	text: string;
};
