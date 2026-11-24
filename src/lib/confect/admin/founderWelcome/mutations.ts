import type { MutationCtx } from '../../../convex/_generated/server';
import {
	CONTACT_SETTING_KEY,
	FOUNDER_EMAIL_SETTING_KEYS,
	readAdminSetting,
	readFounderEmailEnabledAt,
	type SwitchableFounderEmail
} from '../../emails/founderEmailConfig';

async function upsertSetting(ctx: MutationCtx, key: string, value: string, adminUserId: string) {
	const existing = await readAdminSetting(ctx.db, key);

	if (existing) {
		await ctx.db.patch('adminSettings', existing._id, {
			value,
			updatedAt: Date.now(),
			updatedBy: adminUserId
		});
	} else {
		await ctx.db.insert('adminSettings', {
			key,
			value,
			updatedAt: Date.now(),
			updatedBy: adminUserId
		});
	}
}

async function deleteSetting(ctx: MutationCtx, key: string) {
	const existing = await readAdminSetting(ctx.db, key);

	if (existing) {
		await ctx.db.delete('adminSettings', existing._id);
	}
}

export async function readContactUserId(ctx: MutationCtx) {
	return (await readAdminSetting(ctx.db, CONTACT_SETTING_KEY))?.value;
}

export async function saveFounderWelcomeConfig(
	ctx: MutationCtx,
	adminUserId: string,
	config: { name: string; title: string; subject: string; body: string; replyTo?: string }
) {
	await upsertSetting(ctx, CONTACT_SETTING_KEY, adminUserId, adminUserId);

	const existingProfile = await ctx.db
		.query('adminProfiles')
		.withIndex('by_user', (q) => q.eq('userId', adminUserId))
		.unique();

	if (existingProfile) {
		await ctx.db.patch('adminProfiles', existingProfile._id, {
			founderWelcomeName: config.name,
			founderWelcomeTitle: config.title,
			founderWelcomeReplyTo: config.replyTo
		});
	} else {
		await ctx.db.insert('adminProfiles', {
			userId: adminUserId,
			founderWelcomeName: config.name,
			founderWelcomeTitle: config.title,
			founderWelcomeReplyTo: config.replyTo
		});
	}

	await upsertSetting(ctx, 'founderWelcome.subject', config.subject, adminUserId);
	await upsertSetting(ctx, 'founderWelcome.body', config.body, adminUserId);
}

export async function clearContact(ctx: MutationCtx) {
	await deleteSetting(ctx, CONTACT_SETTING_KEY);
}

export async function switchFounderEmail(
	ctx: MutationCtx,
	adminUserId: string,
	email: SwitchableFounderEmail,
	enabled: boolean
) {
	const key = FOUNDER_EMAIL_SETTING_KEYS[email].enabledAt;
	if (!enabled) {
		await deleteSetting(ctx, key);
	} else if ((await readFounderEmailEnabledAt(ctx.db, email)) === undefined) {
		await upsertSetting(ctx, key, String(Date.now()), adminUserId);
	}
}

export async function saveFounderEmailTemplate(
	ctx: MutationCtx,
	adminUserId: string,
	email: SwitchableFounderEmail,
	template: { subject: string; body: string }
) {
	const keys = FOUNDER_EMAIL_SETTING_KEYS[email];
	await upsertSetting(ctx, keys.subject, template.subject, adminUserId);
	await upsertSetting(ctx, keys.body, template.body, adminUserId);
}
