import { z } from 'zod';

export const authParamsSchema = z.object({
	tab: z.enum(['signin', 'signup']).default('signin')
});
