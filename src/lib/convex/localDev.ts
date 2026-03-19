import { v } from 'convex/values';
import { components, internal } from './_generated/api';
import { internalMutation, type MutationCtx } from './_generated/server';
import { createAuth } from './auth';

type BetterAuthUser = {
	_id: string;
	email: string;
	role?: string | null;
	emailVerified?: boolean | null;
};

type LocalCreateUserApi = (context: {
	body: {
		email: string;
		password: string;
		name: string;
		role: 'admin';
	};
}) => Promise<unknown>;

function getRequiredLocalSeedEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing required local seed environment variable: ${name}`);
	}
	return value;
}

async function findUserByEmail(ctx: MutationCtx, email: string): Promise<BetterAuthUser | null> {
	const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: 'email', operator: 'eq', value: email }]
	});
	return (user as BetterAuthUser | null) ?? null;
}

export const ensureSeededAdmin = internalMutation({
	args: {},
	returns: v.object({
		created: v.boolean(),
		updatedRole: v.boolean(),
		updatedVerification: v.boolean(),
		skipped: v.boolean()
	}),
	handler: async (ctx) => {
		if (process.env.LOCAL_CONVEX_DEV !== 'true') {
			throw new Error('localDev:ensureSeededAdmin can only run when LOCAL_CONVEX_DEV=true');
		}

		const email = getRequiredLocalSeedEnv('LOCAL_SEEDED_ADMIN_EMAIL').toLowerCase();
		const password = getRequiredLocalSeedEnv('LOCAL_SEEDED_ADMIN_PASSWORD');
		const name = getRequiredLocalSeedEnv('LOCAL_SEEDED_ADMIN_NAME');

		let created = false;
		let updatedRole = false;
		let updatedVerification = false;
		let user = await findUserByEmail(ctx, email);

		if (!user) {
			const authApi = createAuth(ctx).api as unknown as { createUser: LocalCreateUserApi };
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
			throw new Error(`Failed to create or find local seeded admin user: ${email}`);
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
