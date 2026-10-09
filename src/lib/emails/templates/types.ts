import type { ComponentProps } from 'svelte';
import type { AnonymousRateLimitBucket } from '../../convex/support/rateLimitAlertFields';
import type VerificationEmail from './VerificationEmail.svelte';
import type VerificationCodeEmail from './VerificationCodeEmail.svelte';
import type PasswordResetEmail from './PasswordResetEmail.svelte';
import type AdminReplyNotificationEmail from './AdminReplyNotificationEmail.svelte';
import type NewTicketAdminNotificationEmail from './NewTicketAdminNotificationEmail.svelte';
import type NewUserSignupNotificationEmail from './NewUserSignupNotificationEmail.svelte';
import type SupportRateLimitAlertEmail from './SupportRateLimitAlertEmail.svelte';
import type NewCustomerAdminNotificationEmail from './NewCustomerAdminNotificationEmail.svelte';
import type { ComposedJourney } from '../../convex/admin/customerNotifications/compose';

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
export type SupportRateLimitAlertEmailProps = ComponentProps<typeof SupportRateLimitAlertEmail>;
export type NewCustomerAdminNotificationEmailProps = ComponentProps<
	typeof NewCustomerAdminNotificationEmail
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
 * @property isBareHandoff - True when the user asked for a human with no prior messages,
 *   so the empty-state line reads as a handoff rather than a neutral "no messages"
 * @property userName - User's name or "Anonymous" for anonymous users
 * @property messages - Array of messages to include in the notification
 * @property adminDashboardLink - Link to the admin dashboard for this thread
 */
export type NewTicketAdminNotificationEmailData = {
	isReopen: boolean;
	isBareHandoff: boolean;
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
 * Data required to render a support rate limit alert email
 *
 * Sent to admins when a global anonymous support rate limit stays nearly used up.
 *
 * @property bucket - Which anonymous rate limit is running low
 * @property available - Whole requests left in the bucket when it was sampled
 * @property capacity - Burst capacity of the bucket
 * @property ratePerHour - Sustained refill rate of the bucket
 * @property lowForMinutes - How long the bucket has been sampled as low
 * @property cooldownHours - Minimum hours between two alerts for one bucket
 * @property adminDashboardLink - Link to the admin support dashboard
 */
export type SupportRateLimitAlertEmailData = {
	bucket: AnonymousRateLimitBucket;
	available: number;
	capacity: number;
	ratePerHour: number;
	lowForMinutes: number;
	cooldownHours: number;
	adminDashboardLink: string;
};

/**
 * Data required to render a new customer admin notification email
 *
 * Sent to admins when a customer's first eligible payment is observed.
 *
 * @property customer - The customer's name, or their email when they have none
 * @property customerEmail - The customer's email address
 * @property amount - The first payment, formatted in its currency
 * @property previewText - Inbox preview line
 * @property journey - Tiles and timeline; null renders the email without them
 * @property timeZone - IANA zone every time is shown in, named in the footer
 * @property adminDashboardLink - Link to the admin users page filtered by this customer
 */
export type NewCustomerAdminNotificationEmailData = {
	customer: string;
	customerEmail: string;
	amount: string;
	previewText: string;
	journey: ComposedJourney | null;
	timeZone: string;
	adminDashboardLink: string;
};

/**
 * Common return type for all email render functions
 */
export type RenderedEmail = {
	html: string;
	text: string;
};
