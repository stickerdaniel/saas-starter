import { Autumn } from '@useautumn/convex';
import { components } from './_generated/api';
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Auth } from 'convex/server';

const secretKey = process.env.AUTUMN_SECRET_KEY;
if (!secretKey) {
	throw new Error(
		'AUTUMN_SECRET_KEY is required. Set it with bunx convex env set AUTUMN_SECRET_KEY am_sk_*_...'
	);
}
if (!secretKey.startsWith('am_sk_')) {
	throw new Error("AUTUMN_SECRET_KEY must start with 'am_sk_'");
}

export const autumn = new Autumn(components.autumn, {
	secretKey: process.env.AUTUMN_SECRET_KEY ?? '',
	identify: async (ctx: { auth: Auth }) => {
		// Get the Convex database user ID (clean ID without special characters)
		const userId = await getAuthUserId(ctx);
		if (!userId) return null;

		// Get user identity for name and email
		const identity = await ctx.auth.getUserIdentity();

		return {
			customerId: userId,
			customerData: {
				name: identity?.name,
				email: identity?.email
			}
		};
	}
});

// Re-export with proper types - library has type inference issues
// Using type assertion to avoid TypeScript portability errors with library internals
export const {
	track,
	cancel,
	query,
	attach,
	check,
	checkout,
	usage,
	setupPayment,
	createCustomer,
	listProducts,
	billingPortal,
	createReferralCode,
	redeemReferralCode,
	createEntity,
	getEntity
} = autumn.api() as any;
