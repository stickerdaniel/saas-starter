import * as v from 'valibot';

/**
 * Valibot schema for email validation
 * Used for both server-side validation in data.remote.ts and
 * client-side preflight validation in add-email-dialog.svelte
 */
export const emailSchema = v.object({
	email: v.pipe(v.string(), v.email('Please enter a valid email address'))
});
