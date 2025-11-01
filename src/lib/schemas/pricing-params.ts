import { z } from 'zod';

export const pricingParamsSchema = z.object({
	checkout: z.string().default('')
});
