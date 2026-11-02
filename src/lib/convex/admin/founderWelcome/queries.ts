import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import type { QueryCtx } from '../../_generated/server';
import { adminQuery } from '../../functions';
import {
	readAuthUser,
	readFounderEmailConfig,
	readFounderEmailSender,
	readFounderEmailTemplate,
	type FounderEmail
} from '../../emails/founderEmailConfig';

/** The welcome's config in the shape its readers have always used. */
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

/** The welcome's config, read through its sender like every founder email. */
async function readFounderWelcomeConfig(ctx: QueryCtx): Promise<FounderWelcomeConfig> {
	const config = await readFounderEmailConfig(ctx, 'welcome');
	if (!config.enabled) return { enabled: false };
	const user = await readAuthUser(ctx, config.senderUserId);
	if (!user) return { enabled: false };
	return {
		enabled: true,
		contactUser: { id: config.senderUserId, name: user.name || 'Unknown', email: user.email },
		name: config.name,
		title: config.title,
		subject: config.template.subject,
		body: config.template.body,
		replyTo: config.replyTo
	};
}

/** The viewer's own name, title and reply-to, which pre-fill an email that is off. */
async function readViewerDefaults(ctx: QueryCtx, viewerId: string) {
	const viewer = await readAuthUser(ctx, viewerId);
	const profile = await ctx.db
		.query('adminProfiles')
		.withIndex('by_user', (q) => q.eq('userId', viewerId))
		.unique();
	const fullName = viewer?.name ?? '';
	// Default to first name only for a more personal feel
	const firstName = fullName.split(' ')[0] || fullName;
	return {
		email: viewer?.email ?? '',
		name: profile?.founderWelcomeName ?? firstName,
		title: profile?.founderWelcomeTitle ?? '',
		replyTo: profile?.founderWelcomeReplyTo ?? viewer?.email ?? ''
	};
}

/** What the admin card shows and its dialog starts from, for one email. */
const adminEmailConfigValidator = v.object({
	/** The admin the email goes out from, or null when it is off. */
	senderUserId: v.union(v.string(), v.null()),
	name: v.string(),
	title: v.string(),
	replyTo: v.string(),
	subject: v.string(),
	body: v.string()
});

/**
 * Every founder email for the admin settings page. An email that is on shows its
 * sender's values. One that is off pre-fills the viewer's own last values for it,
 * or else their profile, name and account email.
 */
export const getFounderEmailConfigs = adminQuery({
	args: {},
	returns: v.object({
		welcome: adminEmailConfigValidator,
		feedback: adminEmailConfigValidator,
		cancellation: adminEmailConfigValidator
	}),
	handler: async (ctx) => {
		const viewerId = ctx.user._id;
		const viewer = await readViewerDefaults(ctx, viewerId);

		const forEmail = async (email: FounderEmail) => {
			const config = await readFounderEmailConfig(ctx, email);
			if (config.enabled) {
				return {
					senderUserId: config.senderUserId,
					name: config.name,
					title: config.title,
					replyTo: config.replyTo,
					...config.template
				};
			}
			const sender = await readFounderEmailSender(ctx.db, email);
			const ownsSaved = sender.savedBy === viewerId;
			return {
				senderUserId: null,
				name: (ownsSaved && sender.name) || viewer.name,
				title: (ownsSaved && sender.title) || viewer.title,
				// A reply-to the viewer cleared on this email stays cleared: sending then
				// uses their account address, so the profile default must not return.
				replyTo: ownsSaved ? (sender.replyTo ?? viewer.email) : viewer.replyTo,
				...(await readFounderEmailTemplate(ctx.db, email))
			};
		};

		return {
			welcome: await forEmail('welcome'),
			feedback: await forEmail('feedback'),
			cancellation: await forEmail('cancellation')
		};
	}
});

/**
 * The welcome alone, in the shape the welcome card used before each founder email
 * got its own card. Kept published for browser tabs still running that bundle.
 */
export const getFounderWelcomeConfig = adminQuery({
	args: {},
	returns: v.object({
		config: founderWelcomeConfigValidator,
		viewerProfile: v.object({
			name: v.string(),
			title: v.string(),
			replyTo: v.string()
		})
	}),
	handler: async (ctx) => {
		const viewer = await readViewerDefaults(ctx, ctx.user._id);
		return {
			config: await readFounderWelcomeConfig(ctx),
			viewerProfile: { name: viewer.name, title: viewer.title, replyTo: viewer.replyTo }
		};
	}
});

/**
 * The welcome's config (internal, no auth check). Used by the welcome send and the
 * founder incident sender, which writes as the welcome's sender.
 */
export const getFounderWelcomeConfigInternal = internalQuery({
	args: {},
	returns: founderWelcomeConfigValidator,
	handler: async (ctx): Promise<FounderWelcomeConfig> => {
		return readFounderWelcomeConfig(ctx);
	}
});
