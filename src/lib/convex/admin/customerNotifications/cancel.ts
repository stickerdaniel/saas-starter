import type { EmailId } from '@convex-dev/resend';
import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { resend } from '../../emails/resend';

/**
 * Cancel the admin customer emails the Resend component still holds. Erasure
 * calls this by function reference, which keeps the Resend client out of the
 * account deletion trigger's import graph; Convex refuses a dynamic `import()`
 * inside a mutation. The caller bounds `emailIds` per call.
 *
 * An email is cancelled only while it is `waiting` or `queued`: the component
 * refuses any other status, and a missing email needs nothing. A failure
 * throws, so the calling page rolls back and is retried.
 */
export const cancelUnsentEmails = internalMutation({
	args: { emailIds: v.array(v.string()) },
	returns: v.null(),
	handler: async (ctx, { emailIds }) => {
		for (const emailId of emailIds) {
			const status = await resend.status(ctx, emailId as EmailId);
			if (status?.status === 'waiting' || status?.status === 'queued') {
				await resend.cancelEmail(ctx, emailId as EmailId);
			}
		}
		return null;
	}
});
