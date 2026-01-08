import { Autumn } from '@useautumn/convex';
import { components } from './_generated/api';
import { authComponent } from './auth';
import { getAutumnSecretKey } from './env';

export const autumn = new Autumn(components.autumn, {
	secretKey: getAutumnSecretKey() ?? '',
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
