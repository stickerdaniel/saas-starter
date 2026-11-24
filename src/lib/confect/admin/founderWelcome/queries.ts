import { components } from '../../../convex/_generated/api';
import type { QueryCtx } from '../../../convex/_generated/server';
import {
	readFounderEmailEnabledAt,
	readFounderEmailTemplate,
	readFounderSender,
	readWelcomeTemplate,
	type SwitchableFounderEmail
} from '../../emails/founderEmailConfig';
import type {
	FounderEmailSettingsSchema,
	FounderWelcomeAdminConfigSchema,
	FounderWelcomeConfigSchema
} from './schemas';

export type FounderWelcomeConfig = typeof FounderWelcomeConfigSchema.Type;

export async function readFounderWelcomeConfig(ctx: QueryCtx): Promise<FounderWelcomeConfig> {
	const sender = await readFounderSender(ctx);
	if (!sender) {
		return { enabled: false };
	}
	return { enabled: true, ...sender, ...(await readWelcomeTemplate(ctx.db)) };
}

export async function readFounderWelcomeAdminConfig(
	ctx: QueryCtx,
	viewerId: string
): Promise<typeof FounderWelcomeAdminConfigSchema.Type> {
	const config = await readFounderWelcomeConfig(ctx);

	const viewerProfile = await ctx.db
		.query('adminProfiles')
		.withIndex('by_user', (q) => q.eq('userId', viewerId))
		.unique();

	const viewerUser = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', operator: 'eq', value: viewerId }]
	});
	const viewer = viewerUser as { name?: string; email?: string } | null;
	const viewerFullName = viewer?.name ?? '';
	const viewerFirstName = viewerFullName.split(' ')[0] || viewerFullName;
	const viewerEmail = viewer?.email ?? '';

	return {
		config,
		viewerProfile: {
			name: viewerProfile?.founderWelcomeName ?? viewerFirstName,
			title: viewerProfile?.founderWelcomeTitle ?? '',
			replyTo: viewerProfile?.founderWelcomeReplyTo ?? viewerEmail
		}
	};
}

export async function readFounderEmailSettings(
	ctx: QueryCtx,
	viewerId: string
): Promise<typeof FounderEmailSettingsSchema.Type> {
	const sender = await readFounderSender(ctx);
	const forEmail = async (email: SwitchableFounderEmail) => ({
		on: (await readFounderEmailEnabledAt(ctx.db, email)) !== undefined,
		...(await readFounderEmailTemplate(ctx.db, email))
	});
	return {
		sender: sender && { name: sender.name, title: sender.title },
		canEdit: sender?.contactUser.id === viewerId,
		feedback: await forEmail('feedback'),
		cancellation: await forEmail('cancellation')
	};
}
