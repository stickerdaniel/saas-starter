import Resend from '@auth/core/providers/resend';
import type { RandomReader } from '@oslojs/crypto/random';
import { generateRandomString } from '@oslojs/crypto/random';
import { internal } from '../_generated/api';

/**
 * Resend OTP provider for Convex Auth
 *
 * This provider integrates with the @convex-dev/resend component
 * for reliable, production-ready email delivery with:
 * - Automatic queuing and batching
 * - Durable execution (survives server restarts)
 * - Built-in idempotency (prevents duplicates)
 * - Rate limit compliance
 * - Email event tracking via webhooks
 *
 * Configuration:
 * - RESEND_API_KEY: Set via `bunx convex env set RESEND_API_KEY your_key`
 * - AUTH_EMAIL: Set via `bunx convex env set AUTH_EMAIL noreply@yourdomain.com`
 */
export const ResendOTP = Resend({
	id: 'resend-otp',
	// Note: apiKey is still required by the auth provider interface
	// but our actual sending is done through the Convex component
	apiKey: (() => {
		if (!process.env.RESEND_API_KEY) {
			throw new Error(
				'RESEND_API_KEY environment variable is required. ' +
					'Set it via: bunx convex env set RESEND_API_KEY your_key'
			);
		}
		return process.env.RESEND_API_KEY;
	})(),

	/**
	 * Generate a cryptographically secure 8-digit OTP code
	 */
	async generateVerificationToken() {
		const random: RandomReader = {
			read(bytes) {
				crypto.getRandomValues(bytes);
			}
		};

		const alphabet = '0123456789';
		const length = 8;
		return generateRandomString(random, alphabet, length);
	},

	/**
	 * Send verification email using the Convex Resend component
	 *
	 * Instead of calling the Resend API directly, we use an internal mutation
	 * that leverages the @convex-dev/resend component for better reliability.
	 *
	 * Note: The ctx parameter is passed as the second argument by Convex Auth,
	 * even though it's not in the Auth.js type definition.
	 */
	// @ts-expect-error - Convex Auth passes ctx as second parameter (not in Auth.js types)
	async sendVerificationRequest(
		{
			identifier: email,
			provider: _provider,
			token
		}: { identifier: string; provider: any; token: string },
		ctx: any
	) {
		await ctx.runMutation(internal.emails.send.sendVerificationEmail, {
			email,
			code: token,
			expiryMinutes: 20
		});
	}
});
