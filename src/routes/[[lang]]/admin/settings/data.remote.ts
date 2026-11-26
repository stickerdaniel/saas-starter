import { form, getRequestEvent } from '$app/server';
import { invalid } from '@sveltejs/kit';
import * as Effect from 'effect/Effect';
import { api } from '#lib/convex/_generated/api.js';
import { NOTIFICATION_EMAIL_ALREADY_EXISTS } from '#lib/confect/admin/notificationPreferences/errors.js';
import { createServerConvexHttpClient } from '#lib/server/convex-http.js';
import { fromPromise, runRequestEffect, ServerRequest } from '#lib/server/effect-runtime.js';
import { getConvexErrorCode } from '#lib/utils/convex-errors.js';
import { addEmailSchema } from './email-schema';

/**
 * Remote form for adding a custom email recipient
 *
 * Uses SvelteKit remote functions with Valibot validation.
 * Calls Convex mutation server-side with proper authentication.
 */
export const addEmailForm = form(addEmailSchema, ({ email }, issue) =>
	runRequestEffect(
		getRequestEvent(),
		Effect.gen(function* () {
			const { locals } = yield* ServerRequest;
			const client = createServerConvexHttpClient({ token: locals.token });

			const normalizedEmail = email.trim().toLowerCase();

			yield* fromPromise(() =>
				client.mutation(api.admin.notificationPreferences.mutations.addCustomEmail, {
					email: normalizedEmail
				})
			).pipe(
				Effect.catch((err) => {
					if (getConvexErrorCode(err) !== NOTIFICATION_EMAIL_ALREADY_EXISTS) {
						return Effect.fail(err);
					}
					// Return validation error - don't re-throw. The translation key is
					// resolved client-side via translateRemoteFormIssues.
					return Effect.sync(() => invalid(issue.email('admin.settings.email_exists')));
				})
			);
			return { success: true };
		})
	)
);
