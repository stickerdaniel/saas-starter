import { v } from 'convex/values';
import { components } from '../../_generated/api';
import { internalQuery } from '../../_generated/server';
import type { QueryCtx } from '../../_generated/server';
import { adminQuery } from '../../functions';
import { FOUNDER_WELCOME_DEFAULTS } from '../../emails/helpers';

type FounderWelcomeConfig =
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
	const contactSetting = await ctx.db
		.query('adminSettings')
		.withIndex('by_key', (q) => q.eq('key', 'founderWelcome.contactUserId'))
		.unique();

	if (!contactSetting) {
		return { enabled: false as const };
	}

	const contactUserId = contactSetting.value;

	const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', operator: 'eq', value: contactUserId }]
	});

	if (!user) {
		return { enabled: false as const };
	}

	const { name, email } = user as { name?: string; email: string };

	// Read per-user profile for contact person
	const profile = await ctx.db
		.query('adminProfiles')
		.withIndex('by_userId', (q) => q.eq('userId', contactUserId))
		.unique();

	// Read global email config
	const subjectSetting = await ctx.db
		.query('adminSettings')
		.withIndex('by_key', (q) => q.eq('key', 'founderWelcome.subject'))
		.unique();
	const bodySetting = await ctx.db
		.query('adminSettings')
		.withIndex('by_key', (q) => q.eq('key', 'founderWelcome.body'))
		.unique();

	return {
		enabled: true as const,
		contactUser: {
			id: contactUserId,
			name: name || 'Unknown',
			email
		},
		name: profile?.founderWelcomeName ?? name ?? 'Unknown',
		title: profile?.founderWelcomeTitle ?? '',
		subject: subjectSetting?.value ?? FOUNDER_WELCOME_DEFAULTS.subject,
		body: bodySetting?.value ?? FOUNDER_WELCOME_DEFAULTS.body,
		replyTo: profile?.founderWelcomeReplyTo ?? email
	};
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
			.withIndex('by_userId', (q) => q.eq('userId', ctx.user._id))
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

/**
 * Get founder welcome config (internal, no auth check)
 * Used by send.ts and auth.ts triggers.
 */
export const getFounderWelcomeConfigInternal = internalQuery({
	args: {},
	returns: founderWelcomeConfigValidator,
	handler: async (ctx): Promise<FounderWelcomeConfig> => {
		return readFounderWelcomeConfig(ctx);
	}
});
