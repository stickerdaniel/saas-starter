import { Autumn } from '@useautumn/convex';
import { components } from './_generated/api';
import { authComponent } from './auth';
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
	identify: async (ctx: Parameters<typeof authComponent.getAuthUser>[0]) => {
		// Get the authenticated user from Better Auth
		const user = await authComponent.getAuthUser(ctx);
		if (!user) return null;

		return {
			customerId: user._id,
			customerData: {
				name: user.name,
				email: user.email
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
