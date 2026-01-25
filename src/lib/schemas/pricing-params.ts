import * as v from 'valibot';

export const pricingParamsSchema = v.object({
	checkout: v.optional(v.fallback(v.string(), ''), '')
});
