import { v } from 'convex/values';
import { components } from '../../_generated/api';
import { internalQuery } from '../../_generated/server';
import { adminQuery } from '../../functions';
import { FOUNDER_WELCOME_DEFAULTS } from '../../emails/helpers';

const founderWelcomeConfigValidator = v.union(
	v.object({
		enabled: v.literal(true),
		contactUser: v.object({
			id: v.string(),
			name: v.string(),
			email: v.string()
		}),
		title: v.string(),
		subject: v.string(),
		body: v.string()
	}),
	v.object({
		enabled: v.literal(false)
	})
);

/**
 * Get founder welcome config (admin-facing)
 */
export const getFounderWelcomeConfig = adminQuery({
	args: {},
	returns: founderWelcomeConfigValidator,
	handler: async (ctx) => {
		const contactSetting = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', 'founderWelcome.contactUserId'))
			.unique();

		if (!contactSetting) {
			return { enabled: false as const };
		}

		const contactUserId = contactSetting.value;

		// Resolve contact person from Better Auth user table
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: contactUserId }]
		});

		if (!user) {
			return { enabled: false as const };
		}

		const { name, email } = user as { name?: string; email: string };

		// Read other settings
		const titleSetting = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', 'founderWelcome.title'))
			.unique();
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
			title: titleSetting?.value ?? '',
			subject: subjectSetting?.value ?? FOUNDER_WELCOME_DEFAULTS.subject,
			body: bodySetting?.value ?? FOUNDER_WELCOME_DEFAULTS.body
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
	handler: async (ctx) => {
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

		const titleSetting = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', 'founderWelcome.title'))
			.unique();
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
			title: titleSetting?.value ?? '',
			subject: subjectSetting?.value ?? FOUNDER_WELCOME_DEFAULTS.subject,
			body: bodySetting?.value ?? FOUNDER_WELCOME_DEFAULTS.body
		};
	}
});
