import { z } from 'zod';

// Email validation schema (reusable across the app)
export const emailSchema = z.string().email();

// URL params schema (for signin/signup tabs)
export const authParamsSchema = z.object({
	tab: z.enum(['signin', 'signup']).default('signin'),
	redirectTo: z.string().default('')
});

// Types
export type AuthParams = z.infer<typeof authParamsSchema>;
