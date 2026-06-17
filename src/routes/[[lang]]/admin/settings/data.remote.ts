import { form, getRequestEvent } from '$app/server';
import { invalid } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import { createServerConvexHttpClient } from '$lib/server/convex-http';
import { addEmailSchema } from './email-schema';

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
		if (err instanceof Error && err.message.includes('already exists')) {
			// Return validation error - don't re-throw. The translation key is
			// resolved client-side via translateRemoteFormIssues.
			return invalid(issue.email('admin.settings.email_exists'));
		}
		throw err;
	}
});
