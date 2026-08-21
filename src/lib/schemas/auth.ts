import * as v from 'valibot';

// Email validation schema (reusable across the app)
export const emailSchema = v.pipe(v.string(), v.email('validation.email.invalid'));

// URL params schema for auth pages (no tab switching)
export const redirectParamsSchema = v.object({
	redirectTo: v.optional(v.fallback(v.string(), ''), ''),
	// Set by Better Auth when an OAuth callback fails. The browser has left the
	// page that started the flow by then, so the reason can only come back
	// through the redirect. The pages read it once and clear it.
	error: v.optional(v.fallback(v.string(), ''), '')
});

// Types
export type RedirectParams = v.InferOutput<typeof redirectParamsSchema>;
