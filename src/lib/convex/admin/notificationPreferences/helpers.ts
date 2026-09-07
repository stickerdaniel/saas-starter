/**
 * Admin Notification Preferences Helpers
 *
 * Plain mutation-context helpers shared by Better Auth triggers (auth.ts),
 * admin role management (admin/mutations.ts), and the dev seeders.
 *
 * Lives in its own file because auth.ts cannot import
 * notificationPreferences/mutations.ts without an import cycle
 * (auth.ts <- functions.ts <- mutations.ts). Same pattern as
 * incrementCounter in admin/counters.ts.
 */

import type { MutationCtx } from '../../_generated/server';

export const PREVIEW_ADMIN_EMAIL = 'admin@preview.dev';

function normalizeNotificationEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function isPreviewAdminEmail(email: string): boolean {
	return normalizeNotificationEmail(email) === PREVIEW_ADMIN_EMAIL;
}

/**
 * Upsert admin notification preferences
 *
 * Called by auth triggers and admin role management utilities when:
 * - User is promoted to admin (setUserRole, seedFirstAdmin)
 * - Admin's email changes
 * - User signs up as admin (rare)
 *
 * If preference exists: updates isAdminUser=true and email
 * If not exists: creates with the identity's notification defaults
 * Preview admins keep the admin role marker but never receive email
 */
export async function syncAdminPreferences(
	ctx: MutationCtx,
	args: { userId: string; email: string }
): Promise<void> {
	const now = Date.now();
	const email = normalizeNotificationEmail(args.email);
	const receivesAdminNotifications = !isPreviewAdminEmail(email);
	const previewAdminPatch = receivesAdminNotifications
		? {}
		: {
				notifyNewSupportTickets: false,
				notifyUserReplies: false,
				notifyNewSignups: false
			};

	// Check if preference already exists for this user
	const existing = await ctx.db
		.query('adminNotificationPreferences')
		.withIndex('by_user', (q) => q.eq('userId', args.userId))
		.first();

	if (existing) {
		// Reactivate and update email if changed
		await ctx.db.patch(existing._id, {
			email,
			isAdminUser: true,
			...previewAdminPatch,
			updatedAt: now
		});
	} else {
		// Check if there's a custom email entry with same email
		const existingByEmail = await ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_email', (q) => q.eq('email', email))
			.first();

		if (existingByEmail && existingByEmail.userId === undefined) {
			// Convert custom email to admin user preference
			await ctx.db.patch(existingByEmail._id, {
				userId: args.userId,
				isAdminUser: true,
				...previewAdminPatch,
				updatedAt: now
			});
		} else if (existingByEmail && isPreviewAdminEmail(email)) {
			await ctx.db.patch(existingByEmail._id, {
				userId: args.userId,
				isAdminUser: true,
				...previewAdminPatch,
				updatedAt: now
			});
		} else if (!existingByEmail) {
			// Create new preference with the appropriate notification defaults
			await ctx.db.insert('adminNotificationPreferences', {
				email,
				userId: args.userId,
				isAdminUser: true,
				notifyNewSupportTickets: receivesAdminNotifications,
				notifyUserReplies: receivesAdminNotifications,
				notifyNewSignups: receivesAdminNotifications,
				createdAt: now,
				updatedAt: now
			});
		} else {
			// existingByEmail exists with a different userId - data integrity issue
			// Log warning but don't throw to avoid blocking auth flow
			console.warn(
				`[syncAdminPreferences] Email collision detected: ` +
					`email=${email} already belongs to userId=${existingByEmail.userId} ` +
					`but attempting to assign to userId=${args.userId}. Skipping update.`
			);
		}
	}
}

/**
 * Deactivate admin notification preferences
 *
 * Called by auth trigger and setUserRole when an admin is demoted.
 * Sets isAdminUser=false but keeps the record for potential re-promotion.
 */
export async function deactivateAdminPreferencesHelper(
	ctx: MutationCtx,
	userId: string
): Promise<void> {
	const existing = await ctx.db
		.query('adminNotificationPreferences')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.first();

	if (existing) {
		await ctx.db.patch(existing._id, {
			isAdminUser: false,
			updatedAt: Date.now()
		});
	}
}
