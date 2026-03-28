import * as v from 'valibot';

// Email validation schema (reusable across the app)
export const emailSchema = v.pipe(v.string(), v.email());

// URL params schema for auth pages (redirectTo only, no tab switching)
export const redirectParamsSchema = v.object({
	redirectTo: v.optional(v.fallback(v.string(), ''), '')
});

// Legacy alias — remove once all consumers are migrated
export const authParamsSchema = redirectParamsSchema;

// Types
export type RedirectParams = v.InferOutput<typeof redirectParamsSchema>;
export type AuthParams = RedirectParams;
