import { v } from 'convex/values';
import { components, internal } from './_generated/api';
import { internalMutation, type MutationCtx } from './_generated/server';
import { createAuth } from './auth';

const PREVIEW_ADMIN_EMAIL = 'admin@preview.dev';
const PREVIEW_ADMIN_NAME = 'Preview Admin';

type BetterAuthUser = {
	_id: string;
	email: string;
	role?: string | null;
	emailVerified?: boolean | null;
};

type CreateUserApi = (context: {
	body: {
		email: string;
		password: string;
		name: string;
		role: 'admin';
	};
}) => Promise<unknown>;

async function findUserByEmail(ctx: MutationCtx, email: string): Promise<BetterAuthUser | null> {
	const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: 'email', operator: 'eq', value: email }]
	});
	return (user as BetterAuthUser | null) ?? null;
}

// Invoked by preview deploy script (scripts/deploy.ts)
export const ensurePreviewAdmin = internalMutation({
	args: {},
	returns: v.object({
		created: v.boolean(),
		updatedRole: v.boolean(),
		updatedVerification: v.boolean(),
		skipped: v.boolean()
	}),
	handler: async (ctx) => {
		const password = process.env.PREVIEW_ADMIN_PASSWORD?.trim();
		if (!password) {
			throw new Error(
				'previewDev:ensurePreviewAdmin requires PREVIEW_ADMIN_PASSWORD env var to be set'
			);
		}

		const email = PREVIEW_ADMIN_EMAIL;
		const name = PREVIEW_ADMIN_NAME;

		let created = false;
		let updatedRole = false;
		let updatedVerification = false;
		let user = await findUserByEmail(ctx, email);

		if (!user) {
			const authApi = createAuth(ctx).api as unknown as { createUser: CreateUserApi };
			await authApi.createUser({
				body: {
					email,
					password,
					name,
					role: 'admin'
				}
			});
			created = true;
			user = await findUserByEmail(ctx, email);
		}

		if (!user) {
			throw new Error(`Failed to create or find preview admin user: ${email}`);
		}

		const update: Record<string, string | boolean> = {};
		if (user.role !== 'admin') {
			update.role = 'admin';
			updatedRole = true;
		}
		if (user.emailVerified !== true) {
			update.emailVerified = true;
			updatedVerification = true;
		}

		if (updatedRole || updatedVerification) {
			await ctx.runMutation(components.betterAuth.adapter.updateOne, {
				input: {
					model: 'user',
					where: [{ field: '_id', operator: 'eq', value: user._id }],
					update
				}
			});
		}

		await ctx.runMutation(internal.admin.notificationPreferences.mutations.upsertAdminPreferences, {
			userId: user._id,
			email
		});

		return {
			created,
			updatedRole,
			updatedVerification,
			skipped: !created && !updatedRole && !updatedVerification
		};
	}
});
