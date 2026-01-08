import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { requireRunMutationCtx } from '@convex-dev/better-auth/utils';
import { convex } from '@convex-dev/better-auth/plugins';
import { components, internal } from './_generated/api';
import { type DataModel } from './_generated/dataModel';
import { query } from './_generated/server';
import { passkey } from '@better-auth/passkey';
import { admin } from 'better-auth/plugins/admin';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import authSchema from './betterAuth/schema';
import authConfig from './auth.config';
import { getBetterAuthSecret, getSiteUrl, googleOAuth, githubOAuth } from './env';

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
// Using local schema to include admin plugin fields (role, banned, etc.)
export const authComponent = createClient<DataModel, typeof authSchema>(components.betterAuth, {
	local: {
		schema: authSchema
	}
});

// Creates Better Auth options object (used by adapter and betterAuth CLI)
export const createAuthOptions = (ctx: GenericCtx<DataModel>): BetterAuthOptions => {
	return {
		baseURL: getSiteUrl(),
		secret: getBetterAuthSecret(),
		database: authComponent.adapter(ctx),
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
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
		emailVerification: {
			// Email verification (moved from emailAndPassword in Better Auth 1.4.x)
			sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
				const mutationCtx = requireRunMutationCtx(ctx);
				await mutationCtx.runMutation(internal.emails.send.sendVerificationEmail, {
					email: user.email,
					verificationUrl: url,
					expiryMinutes: 20
				});
			},
			sendOnSignUp: true,
			autoSignInAfterVerification: false
		},
		socialProviders: {
			google: {
				enabled: googleOAuth.enabled,
				clientId: googleOAuth.clientId as string,
				clientSecret: googleOAuth.clientSecret as string
			},
			github: {
				enabled: githubOAuth.enabled,
				clientId: githubOAuth.clientId as string,
				clientSecret: githubOAuth.clientSecret as string
			}
		},
		plugins: [
			// The Convex plugin is required for Convex compatibility
			convex({
				authConfig,
				jwksRotateOnTokenGenerationError: true
			}),
			passkey(),
			admin({
				defaultRole: 'user',
				adminRoles: ['admin']
			})
		]
	};
};

// Creates Better Auth instance (used in http.ts for routes)
export const createAuth = (ctx: GenericCtx<DataModel>) => {
	return betterAuth(createAuthOptions(ctx));
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
