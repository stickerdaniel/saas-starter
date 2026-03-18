import { adminMutation } from '../functions';
import { vEmailId } from '@convex-dev/resend';
import { resend } from './resend';

/**
 * Cancel a queued email
 *
 * Attempts to cancel an email that hasn't been sent yet.
 * Only works if the email is still in the queue and hasn't been
 * sent to the Resend API yet.
 *
 * Note: Cancellation does not trigger an email event.
 *
 * @security Requires admin role - only admins can cancel emails
 */
export const cancelEmail = adminMutation({
	args: {
		emailId: vEmailId
	},
	handler: async (ctx, args) => {
		try {
			await resend.cancelEmail(ctx, args.emailId);
			console.log(`Email ${args.emailId} canceled successfully`);
			return { success: true, message: 'Email canceled' };
		} catch (error) {
			console.error(`Failed to cancel email ${args.emailId}:`, error);
			return {
				success: false,
				message: 'Email could not be canceled (may have already been sent)'
			};
		}
	}
});
