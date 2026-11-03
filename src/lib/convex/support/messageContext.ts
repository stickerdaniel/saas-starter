import type { MutationCtx } from '../_generated/server';
import { normalizeSupportAppVersion } from '../../shared/support-app-version';
import { normalizeSupportPageRoute } from '../../shared/support-page-route';

/**
 * Records where a support message was sent from and which build sent it.
 *
 * Call it after the message is saved. Both fields are client-reported and
 * optional: each is normalized on its own, the row keeps whichever survives,
 * and no row is written when neither does. Invalid metadata therefore never
 * fails the write that already saved the message.
 */
export async function recordSupportMessageContext(
	ctx: MutationCtx,
	context: {
		threadId: string;
		messageId: string;
		pageUrl: string | undefined;
		appVersion: string | undefined;
	}
): Promise<void> {
	const pageUrl = normalizeSupportPageRoute(context.pageUrl);
	const appVersion = normalizeSupportAppVersion(context.appVersion);
	if (!pageUrl && !appVersion) return;

	await ctx.db.insert('supportMessageContexts', {
		threadId: context.threadId,
		messageId: context.messageId,
		...(pageUrl ? { pageUrl } : {}),
		...(appVersion ? { appVersion } : {}),
		createdAt: Date.now()
	});
}
