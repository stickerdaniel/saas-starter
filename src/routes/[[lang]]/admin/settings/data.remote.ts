import { form, getRequestEvent } from '$app/server';
import { invalid } from '@sveltejs/kit';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { api } from '$lib/convex/_generated/api';
import { emailSchema } from './email-schema';

/**
 * Remote form for adding a custom email recipient
 *
 * Uses SvelteKit remote functions with Zod validation.
 * Calls Convex mutation server-side with proper authentication.
 */
export const addEmailForm = form(emailSchema, async ({ email }, issue) => {
	const event = getRequestEvent();
	const client = createConvexHttpClient({ token: event.locals.token });

	const normalizedEmail = email.trim().toLowerCase();

	try {
		await client.mutation(api.admin.notificationPreferences.mutations.addCustomEmail, {
			email: normalizedEmail
		});
		return { success: true };
	} catch (err) {
		if (err instanceof Error && err.message.includes('already exists')) {
			invalid(issue.email('This email already exists'));
		}
		throw err;
	}
});
