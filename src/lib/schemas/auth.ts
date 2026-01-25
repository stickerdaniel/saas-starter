import * as v from 'valibot';

// Email validation schema (reusable across the app)
export const emailSchema = v.pipe(v.string(), v.email());

// URL params schema (for signin/signup tabs)
export const authParamsSchema = v.object({
	tab: v.optional(v.fallback(v.picklist(['signin', 'signup']), 'signin'), 'signin'),
	redirectTo: v.optional(v.fallback(v.string(), ''), '')
});

// Types
export type AuthParams = v.InferOutput<typeof authParamsSchema>;
