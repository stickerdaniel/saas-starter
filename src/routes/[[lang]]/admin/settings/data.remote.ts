import { form, getRequestEvent } from '$app/server';
import { invalid } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import { createServerConvexHttpClient } from '$lib/server/convex-http';
import { addEmailSchema } from './email-schema';
import { getConvexErrorCode } from '$lib/utils/convex-errors';
import { NOTIFICATION_EMAIL_ALREADY_EXISTS } from '$lib/convex/admin/notificationPreferences/errors';

/**
 * Remote form for adding a custom email recipient
 *
 * Uses SvelteKit remote functions with Valibot validation.
 * Calls Convex mutation server-side with proper authentication.
 */
export const addEmailForm = form(addEmailSchema, async ({ email }, issue) => {
	const event = getRequestEvent();
	const client = createServerConvexHttpClient({ token: event.locals.token });

	const normalizedEmail = email.trim().toLowerCase();

	try {
		await client.mutation(api.admin.notificationPreferences.mutations.addCustomEmail, {
			email: normalizedEmail
		});
		return { success: true };
	} catch (err) {
		if (getConvexErrorCode(err) === NOTIFICATION_EMAIL_ALREADY_EXISTS) {
			// Return validation error - don't re-throw. The translation key is
			// resolved client-side via translateRemoteFormIssues.
			return invalid(issue.email('admin.settings.email_exists'));
		}
		throw err;
	}
});
