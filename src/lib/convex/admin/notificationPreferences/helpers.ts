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

/**
 * Upsert admin notification preferences
 *
 * Called by auth triggers and admin role management utilities when:
 * - User is promoted to admin (setUserRole, seedFirstAdmin)
 * - Admin's email changes
 * - User signs up as admin (rare)
 *
 * If preference exists: updates isAdminUser=true and email
 * If not exists: creates with all toggles ON
 */
export async function syncAdminPreferences(
	ctx: MutationCtx,
	args: { userId: string; email: string }
): Promise<void> {
	const now = Date.now();

	// Check if preference already exists for this user
	const existing = await ctx.db
		.query('adminNotificationPreferences')
		.withIndex('by_user', (q) => q.eq('userId', args.userId))
		.first();

	if (existing) {
		// Reactivate and update email if changed
		await ctx.db.patch(existing._id, {
			email: args.email.toLowerCase().trim(),
			isAdminUser: true,
			updatedAt: now
		});
	} else {
		// Check if there's a custom email entry with same email
		const existingByEmail = await ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_email', (q) => q.eq('email', args.email.toLowerCase().trim()))
			.first();

		if (existingByEmail && existingByEmail.userId === undefined) {
			// Convert custom email to admin user preference
			await ctx.db.patch(existingByEmail._id, {
				userId: args.userId,
				isAdminUser: true,
				updatedAt: now
			});
		} else if (!existingByEmail) {
			// Create new preference with all notifications enabled
			await ctx.db.insert('adminNotificationPreferences', {
				email: args.email.toLowerCase().trim(),
				userId: args.userId,
				isAdminUser: true,
				notifyNewSupportTickets: true,
				notifyUserReplies: true,
				notifyNewSignups: true,
				createdAt: now,
				updatedAt: now
			});
		} else {
			// existingByEmail exists with a different userId - data integrity issue
			// Log warning but don't throw to avoid blocking auth flow
			console.warn(
				`[syncAdminPreferences] Email collision detected: ` +
					`email=${args.email} already belongs to userId=${existingByEmail.userId} ` +
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
