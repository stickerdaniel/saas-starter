import { v } from 'convex/values';
import { components } from '../../_generated/api';
import { internalQuery } from '../../_generated/server';
import type { QueryCtx } from '../../_generated/server';
import { adminQuery } from '../../functions';
import {
	readFounderEmailEnabledAt,
	readFounderEmailTemplate,
	readFounderSender,
	readWelcomeTemplate,
	type SwitchableFounderEmail
} from '../../emails/founderEmailConfig';

export type FounderWelcomeConfig =
	| {
			enabled: true;
			contactUser: { id: string; name: string; email: string };
			name: string;
			title: string;
			subject: string;
			body: string;
			replyTo: string;
	  }
	| { enabled: false };

const founderWelcomeConfigValidator = v.union(
	v.object({
		enabled: v.literal(true),
		contactUser: v.object({
			id: v.string(),
			name: v.string(),
			email: v.string()
		}),
		name: v.string(),
		title: v.string(),
		subject: v.string(),
		body: v.string(),
		replyTo: v.string()
	}),
	v.object({
		enabled: v.literal(false)
	})
);

/** Shared config reader used by both admin and internal queries */
async function readFounderWelcomeConfig(ctx: QueryCtx): Promise<FounderWelcomeConfig> {
	const sender = await readFounderSender(ctx);
	if (!sender) {
		return { enabled: false as const };
	}
	return { enabled: true as const, ...sender, ...(await readWelcomeTemplate(ctx.db)) };
}

/** Admin-facing config query — includes viewer's own profile for form pre-fill */
const adminConfigValidator = v.object({
	config: founderWelcomeConfigValidator,
	viewerProfile: v.object({
		name: v.string(),
		title: v.string(),
		replyTo: v.string()
	})
});

export const getFounderWelcomeConfig = adminQuery({
	args: {},
	returns: adminConfigValidator,
	handler: async (ctx) => {
		const config = await readFounderWelcomeConfig(ctx);

		// Read viewer's own profile for form pre-fill
		const viewerProfile = await ctx.db
			.query('adminProfiles')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.unique();

		const viewerUser = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: ctx.user._id }]
		});
		const viewer = viewerUser as { name?: string; email?: string } | null;
		const viewerFullName = viewer?.name ?? '';
		// Default to first name only for a more personal feel
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
});

const switchableEmailSettingsValidator = v.object({
	/** The switch alone; the email also needs a contact to go out. */
	on: v.boolean(),
	subject: v.string(),
	body: v.string()
});

/**
 * The feedback and cancellation cards: each email's switch and template, the
 * shared sender they go out as (null without a contact), and whether the viewer
 * may change them, which only the contact may.
 */
export const getFounderEmailSettings = adminQuery({
	args: {},
	returns: v.object({
		sender: v.union(v.null(), v.object({ name: v.string(), title: v.string() })),
		canEdit: v.boolean(),
		feedback: switchableEmailSettingsValidator,
		cancellation: switchableEmailSettingsValidator
	}),
	handler: async (ctx) => {
		const sender = await readFounderSender(ctx);
		const forEmail = async (email: SwitchableFounderEmail) => ({
			on: (await readFounderEmailEnabledAt(ctx.db, email)) !== undefined,
			...(await readFounderEmailTemplate(ctx.db, email))
		});
		return {
			sender: sender && { name: sender.name, title: sender.title },
			canEdit: sender?.contactUser.id === ctx.user._id,
			feedback: await forEmail('feedback'),
			cancellation: await forEmail('cancellation')
		};
	}
});

/**
 * Get founder welcome config (internal, no auth check)
 * Used by the welcome send and the founder incident sender, which writes as the
 * welcome's contact person.
 */
export const getFounderWelcomeConfigInternal = internalQuery({
	args: {},
	returns: founderWelcomeConfigValidator,
	handler: async (ctx): Promise<FounderWelcomeConfig> => {
		return readFounderWelcomeConfig(ctx);
	}
});
