import * as v from 'valibot';

// Email validation schema (reusable across the app)
export const emailSchema = v.pipe(v.string(), v.email('validation.email.invalid'));

// URL params schema for auth pages (no tab switching)
export const redirectParamsSchema = v.object({
	redirectTo: v.optional(v.fallback(v.string(), ''), ''),
	// Set by Better Auth when an OAuth callback fails. The browser has left the
	// page that started the flow by then, so the reason can only come back
	// through the redirect. The pages read it once and clear it.
	error: v.optional(v.fallback(v.string(), ''), ''),
	// Better Auth forwards the provider's raw description next to the code. The
	// app never shows it, but an unmodelled parameter would stay in the address
	// bar after the code is cleared and reach analytics through the page URL.
	error_description: v.optional(v.fallback(v.string(), ''), '')
});

// Types
export type RedirectParams = v.InferOutput<typeof redirectParamsSchema>;
