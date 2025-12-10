import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { requireRunMutationCtx } from '@convex-dev/better-auth/utils';
import { convex } from '@convex-dev/better-auth/plugins';
import { components, internal } from './_generated/api';
import { type DataModel } from './_generated/dataModel';
import { query } from './_generated/server';
import { betterAuth } from 'better-auth';
import { passkey } from 'better-auth/plugins/passkey';

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel>(components.betterAuth);

const LOCAL_SITE_URL = 'http://localhost:5173';

export const createAuth = (ctx: GenericCtx<DataModel>) => {
	const siteUrl = process.env.SITE_URL ?? process.env.PUBLIC_SITE_URL ?? LOCAL_SITE_URL;

	if (!process.env.SITE_URL) {
		if (process.env.NODE_ENV === 'production') {
			throw new Error(
				'SITE_URL environment variable is required.\n' +
					'- Convex: bunx convex env set SITE_URL https://yoursite.com\n' +
					'- Vercel: vercel env add SITE_URL production'
			);
		}

		console.warn(`SITE_URL not set; falling back to ${siteUrl}`);
	}

	return betterAuth({
		baseURL: siteUrl,
		database: authComponent.adapter(ctx),
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
			// Custom email sending via Convex Resend component
			sendVerificationEmail: async ({
				user,
				token
			}: {
				user: { email: string };
				token: string;
			}) => {
				const mutationCtx = requireRunMutationCtx(ctx);
				await mutationCtx.runMutation(internal.emails.send.sendVerificationEmail, {
					email: user.email,
					code: token,
					expiryMinutes: 20
				});
			},
			// Password reset email
			sendResetPassword: async ({
				user,
				url
			}: {
				user: { email: string; name?: string };
				url: string;
			}) => {
				const mutationCtx = requireRunMutationCtx(ctx);
				await mutationCtx.runMutation(internal.emails.send.sendResetPasswordEmail, {
					email: user.email,
					resetUrl: url,
					userName: user.name
				});
			}
		},
		socialProviders: {
			google: {
				enabled: !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
				clientId: process.env.AUTH_GOOGLE_ID as string,
				clientSecret: process.env.AUTH_GOOGLE_SECRET as string
			},
			github: {
				enabled: !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
				clientId: process.env.AUTH_GITHUB_ID as string,
				clientSecret: process.env.AUTH_GITHUB_SECRET as string
			}
		},
		plugins: [
			// The Convex plugin is required for Convex compatibility
			convex(),
			passkey()
		]
	});
};

// Get current authenticated user
export const getCurrentUser = query({
	args: {},
	handler: async (ctx) => {
		return authComponent.getAuthUser(ctx);
	}
});

// Alias for backward compatibility with existing code
export const viewer = query({
	args: {},
	handler: async (ctx) => {
		return authComponent.getAuthUser(ctx);
	}
});
