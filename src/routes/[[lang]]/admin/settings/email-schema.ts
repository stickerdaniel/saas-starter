import { z } from 'zod';

/**
 * Zod schema for email validation
 * Used for both server-side validation in data.remote.ts and
 * client-side preflight validation in add-email-dialog.svelte
 */
export const emailSchema = z.object({
	email: z.string().email('Please enter a valid email address')
});
