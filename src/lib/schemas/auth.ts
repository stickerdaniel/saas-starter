import * as v from 'valibot';

// Email validation schema (reusable across the app)
export const emailSchema = v.pipe(v.string(), v.email('validation.email.invalid'));

// URL params schema for auth pages (redirectTo only, no tab switching)
export const redirectParamsSchema = v.object({
	redirectTo: v.optional(v.fallback(v.string(), ''), '')
});

// Types
export type RedirectParams = v.InferOutput<typeof redirectParamsSchema>;
