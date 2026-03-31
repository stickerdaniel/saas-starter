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
import { requireEnv, googleOAuth, githubOAuth } from './env';
import { getFounderWelcomeDelay } from './emails/helpers';
import { incrementCounter } from './admin/counters';

// Required for triggers to work - references internal auth functions
const authFunctions: AuthFunctions = internal.auth;

type SignupMethod = 'Email' | 'Google' | 'GitHub';

type SignupNotificationUser = {
	_id: string;
	name?: string | null;
	email: string;
	createdAt: number;
};

type BetterAuthCallbackArg<T extends (...args: any[]) => Promise<void>> = Parameters<T>[0];

type SendResetPasswordArgs = BetterAuthCallbackArg<
	NonNullable<NonNullable<BetterAuthOptions['emailAndPassword']>['sendResetPassword']>
>;

type SendVerificationEmailArgs = BetterAuthCallbackArg<
	NonNullable<NonNullable<BetterAuthOptions['emailVerification']>['sendVerificationEmail']>
>;

function requireAuthUserEmail(
	user: { email?: string | null },
	context: 'reset password email' | 'verification email'
): string {
	const email = user.email?.trim();
	if (!email) {
		throw new Error(`Better Auth attempted to send ${context} without a user email`);
	}
	return email;
}

function isLocalSeededAdmin(user: { email: string }): boolean {
	const localSeededAdminEmail = process.env.LOCAL_SEEDED_ADMIN_EMAIL?.trim().toLowerCase();
	return (
		process.env.LOCAL_CONVEX_DEV === 'true' &&
		!!localSeededAdminEmail &&
		user.email.toLowerCase() === localSeededAdminEmail
	);
}

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
			 * Notification scheduling is intentionally unwrapped — it relies on
			 * Convex transactional atomicity (scheduler + query cannot fail for
			 * data created in the same flow). Preference sync IS wrapped because
			 * it writes to a separate table with more failure modes.
			 */
			onCreate: async (ctx, user) => {
				const seededLocalAdmin = isLocalSeededAdmin(user);

				// --- Materialized dashboard counters ---
				await incrementCounter(ctx, 'totalUsers', 1);
				if (user.role === 'admin') {
					await incrementCounter(ctx, 'adminCount', 1);
				}
				if (user.banned === true) {
					await incrementCounter(ctx, 'bannedCount', 1);
				}

				// Send signup stats email immediately only for already-verified users
				// (e.g. OAuth providers with verified emails)
				if (user.emailVerified && !seededLocalAdmin) {
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

				// Local seeded admin should not enqueue email-dependent onboarding jobs.
				if (!seededLocalAdmin) {
					const contactSetting = await ctx.db
						.query('adminSettings')
						.withIndex('by_key', (q: any) => q.eq('key', 'founderWelcome.contactUserId'))
						.unique();

					if (!contactSetting) {
						return;
					}

					const delayMs = getFounderWelcomeDelay();
					if (user.emailVerified) {
						// OAuth signup: schedule immediately
						const id = await ctx.db.insert('founderWelcomeEmails', {
							userId: user._id,
							signupEmail: user.email,
							delayMs,
							status: 'scheduled',
							createdAt: Date.now()
						});
						const scheduledFnId = await ctx.scheduler.runAfter(
							delayMs,
							internal.emails.send.sendFounderWelcomeEmail,
							{ founderWelcomeId: id }
						);
						await ctx.db.patch(id, { scheduledFnId });
					} else {
						// Email signup: wait for verification
						await ctx.db.insert('founderWelcomeEmails', {
							userId: user._id,
							signupEmail: user.email,
							delayMs,
							status: 'pending_verification',
							createdAt: Date.now()
						});
					}
				}
			},

			/**
			 * Called when a user is deleted
			 * - Decrements materialized dashboard counters
			 */
			onDelete: async (ctx, user) => {
				await incrementCounter(ctx, 'totalUsers', -1);
				if (user.role === 'admin') {
					await incrementCounter(ctx, 'adminCount', -1);
				}
				if (user.banned === true) {
					await incrementCounter(ctx, 'bannedCount', -1);
				}
			},

			/**
			 * Called when a user is updated
			 * - Sends signup notification when email becomes verified
			 * - Detects admin role changes and syncs notification preferences
			 *
			 * Notification scheduling is intentionally unwrapped (see onCreate).
			 * Preference sync IS wrapped to prevent blocking user updates.
			 */
			onUpdate: async (ctx, newUser, oldUser) => {
				const becameVerified = oldUser.emailVerified !== true && newUser.emailVerified === true;
				const wasAdmin = oldUser.role === 'admin';
				const isAdmin = newUser.role === 'admin';
				const wasBanned = oldUser.banned === true;
				const isBanned = newUser.banned === true;
				const seededLocalAdmin = isLocalSeededAdmin(newUser);

				// --- Materialized dashboard counters ---
				if (!wasAdmin && isAdmin) {
					await incrementCounter(ctx, 'adminCount', 1);
				} else if (wasAdmin && !isAdmin) {
					await incrementCounter(ctx, 'adminCount', -1);
				}
				if (!wasBanned && isBanned) {
					await incrementCounter(ctx, 'bannedCount', 1);
				} else if (wasBanned && !isBanned) {
					await incrementCounter(ctx, 'bannedCount', -1);
				}

				if (becameVerified && !seededLocalAdmin) {
					await scheduleNewUserSignupNotification(ctx, newUser);

					// Founder welcome email: schedule if pending
					const founderRow = await ctx.db
						.query('founderWelcomeEmails')
						.withIndex('by_user', (q: any) => q.eq('userId', newUser._id))
						.unique();

					if (founderRow && founderRow.status === 'pending_verification') {
						if (newUser.email === founderRow.signupEmail) {
							const scheduledFnId = await ctx.scheduler.runAfter(
								founderRow.delayMs,
								internal.emails.send.sendFounderWelcomeEmail,
								{ founderWelcomeId: founderRow._id }
							);
							await ctx.db.patch(founderRow._id, { status: 'scheduled', scheduledFnId });
						} else {
							await ctx.db.patch(founderRow._id, {
								status: 'skipped',
								skippedReason: 'email_changed'
							});
						}
					}
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

function buildTrustedOrigins(): string[] {
	const siteUrl = process.env.SITE_URL;
	if (!siteUrl) return [];
	try {
		return [new URL(siteUrl).origin];
	} catch {
		throw new Error(`Invalid SITE_URL: "${siteUrl}". Expected a valid URL.`);
	}
}

// Creates Better Auth options object (used by adapter and betterAuth CLI)
export const createAuthOptions = (ctx: GenericCtx<DataModel>): BetterAuthOptions => {
	return {
		baseURL: requireEnv('SITE_URL'),
		trustedOrigins: buildTrustedOrigins(),
		secret: requireEnv('BETTER_AUTH_SECRET'),
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
			minPasswordLength: 10,
			requireEmailVerification: true,
			// Password reset email
			sendResetPassword: async ({ user, url }: SendResetPasswordArgs) => {
				const mutationCtx = requireRunMutationCtx(ctx);
				const email = requireAuthUserEmail(user, 'reset password email');
				await mutationCtx.runMutation(internal.emails.send.sendResetPasswordEmail, {
					email,
					resetUrl: url,
					userName: user.name ?? undefined
				});
			}
		},
		emailVerification: {
			// Email verification (moved from emailAndPassword in Better Auth 1.4.x)
			sendVerificationEmail: async ({ user, url }: SendVerificationEmailArgs) => {
				const mutationCtx = requireRunMutationCtx(ctx);
				const email = requireAuthUserEmail(user, 'verification email');
				await mutationCtx.runMutation(internal.emails.send.sendVerificationEmail, {
					email,
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

/** Returns which OAuth providers are configured and available */
export const getAvailableOAuthProviders = query({
	args: {},
	handler: async () => ({
		google: googleOAuth.enabled,
		github: githubOAuth.enabled
	})
});
