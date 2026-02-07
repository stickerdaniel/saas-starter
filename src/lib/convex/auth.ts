import { createClient, type GenericCtx, type AuthFunctions } from '@convex-dev/better-auth';
import { requireRunMutationCtx } from '@convex-dev/better-auth/utils';
import { convex } from '@convex-dev/better-auth/plugins';
import { components, internal } from './_generated/api';
import { type DataModel } from './_generated/dataModel';
import { query } from './_generated/server';
import type { GenericMutationCtx } from 'convex/server';
import { passkey } from '@better-auth/passkey';
import { admin } from 'better-auth/plugins/admin';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import authSchema from './betterAuth/schema';
import authConfig from './auth.config';
import { getBetterAuthSecret, getSiteUrl, googleOAuth, githubOAuth } from './env';

// Required for triggers to work - references internal auth functions
const authFunctions: AuthFunctions = internal.auth;

type SignupMethod = 'Email' | 'Google' | 'GitHub';

type SignupNotificationUser = {
	_id: string;
	name?: string | null;
	email: string;
	createdAt: number;
};

const detectSignupMethod = async (
	ctx: GenericMutationCtx<DataModel>,
	userId: string
): Promise<SignupMethod> => {
	const accountResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'account',
		paginationOpts: { cursor: null, numItems: 1 },
		where: [{ field: 'userId', operator: 'eq', value: userId }]
	});
	const account = accountResult.page[0] as { providerId?: string } | undefined;
	return account?.providerId === 'google'
		? 'Google'
		: account?.providerId === 'github'
			? 'GitHub'
			: 'Email';
};

const formatSignupTime = (timestamp: number): string => {
	return new Date(timestamp).toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});
};

const scheduleNewUserSignupNotification = async (
	ctx: GenericMutationCtx<DataModel>,
	user: SignupNotificationUser
): Promise<void> => {
	const signupMethod = await detectSignupMethod(ctx, user._id);
	const signupTime = formatSignupTime(user.createdAt);

	// Schedule signup notification email (runs after transaction commits)
	await ctx.scheduler.runAfter(0, internal.emails.send.sendNewUserSignupNotification, {
		userName: user.name ?? undefined,
		userEmail: user.email,
		signupMethod,
		signupTime
	});
};

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
// Using local schema to include admin plugin fields (role, banned, etc.)
export const authComponent = createClient<DataModel, typeof authSchema>(components.betterAuth, {
	local: {
		schema: authSchema
	},
	authFunctions,
	triggers: {
		user: {
			/**
			 * Called when a new user signs up
			 * - Sends new user signup notification to admins only after verification
			 * - Creates notification preferences if user is admin (rare)
			 *
			 * Non-critical operations are wrapped in try/catch to prevent
			 * blocking user signup if notifications or preferences fail.
			 */
			onCreate: async (ctx, user) => {
				// Send signup stats email immediately only for already-verified users
				// (e.g. OAuth providers with verified emails)
				if (user.emailVerified) {
					await scheduleNewUserSignupNotification(ctx, user);
				}

				// If new user is admin (rare but possible via seeding), create preferences
				// Non-critical: don't block signup if preference creation fails
				if (user.role === 'admin') {
					try {
						await ctx.runMutation(
							internal.admin.notificationPreferences.mutations.upsertAdminPreferences,
							{ userId: user._id, email: user.email }
						);
					} catch (error) {
						console.error('Failed to create admin preferences:', error);
					}
				}
			},

			/**
			 * Called when a user is updated
			 * - Sends signup notification when email becomes verified
			 * - Detects admin role changes and syncs notification preferences
			 *
			 * Non-critical operations are wrapped in try/catch to prevent
			 * blocking user updates if preference sync fails.
			 */
			onUpdate: async (ctx, newUser, oldUser) => {
				const becameVerified = oldUser.emailVerified !== true && newUser.emailVerified === true;
				const wasAdmin = oldUser.role === 'admin';
				const isAdmin = newUser.role === 'admin';

				if (becameVerified) {
					await scheduleNewUserSignupNotification(ctx, newUser);
				}

				try {
					if (!wasAdmin && isAdmin) {
						// Promoted to admin → activate/create preferences
						await ctx.runMutation(
							internal.admin.notificationPreferences.mutations.upsertAdminPreferences,
							{ userId: newUser._id, email: newUser.email }
						);
					} else if (wasAdmin && !isAdmin) {
						// Demoted from admin → deactivate preferences (keep dormant)
						await ctx.runMutation(
							internal.admin.notificationPreferences.mutations.deactivateAdminPreferences,
							{ userId: newUser._id }
						);
					} else if (isAdmin && oldUser.email !== newUser.email) {
						// Admin changed email → update preferences
						await ctx.runMutation(
							internal.admin.notificationPreferences.mutations.upsertAdminPreferences,
							{ userId: newUser._id, email: newUser.email }
						);
					}
				} catch (error) {
					console.error('Failed to sync admin preferences on user update:', error);
				}
			}
		}
	}
});

// Export trigger handlers (required for triggers to be registered)
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

// Creates Better Auth options object (used by adapter and betterAuth CLI)
export const createAuthOptions = (ctx: GenericCtx<DataModel>): BetterAuthOptions => {
	return {
		baseURL: getSiteUrl(),
		secret: getBetterAuthSecret(),
		database: authComponent.adapter(ctx),
		user: {
			additionalFields: {
				locale: {
					type: 'string',
					required: false,
					defaultValue: 'en',
					input: true
				}
			}
		},
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
			autoSignInAfterVerification: true
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

/** Returns which OAuth providers are configured and available */
export const getAvailableOAuthProviders = query({
	args: {},
	handler: async () => ({
		google: googleOAuth.enabled,
		github: githubOAuth.enabled
	})
});
