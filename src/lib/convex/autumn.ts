import { Autumn } from '@useautumn/convex';
import { components } from './_generated/api';
import { authComponent } from './auth';
import { requireEnv } from './env';

export const autumn = new Autumn(components.autumn, {
	secretKey: requireEnv('AUTUMN_SECRET_KEY'),
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
} = autumn.api() as any; // Required: library types reference non-portable internal paths (helpers/utils)
