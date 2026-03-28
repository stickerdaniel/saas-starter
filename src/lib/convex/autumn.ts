import { Autumn } from '@useautumn/convex';
import { components } from './_generated/api';
import { authComponent } from './auth';
import { requireEnv } from './env';

const secretKey = requireEnv('AUTUMN_SECRET_KEY');

export const autumn = new Autumn(components.autumn, {
	secretKey,
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

/**
 * Get direct Autumn SDK for use in internalActions/scheduled functions
 * where there is no auth context (identify callback returns null).
 *
 * Lazy-loaded to avoid bundling autumn-js into mutation code.
 * Pass explicit customer_id to check/track methods.
 * See: https://github.com/useautumn/autumn-js/issues/51
 */
export async function getAutumnSdk() {
	const { Autumn: AutumnSDK } = await import('autumn-js');
	return new AutumnSDK({ secretKey });
}
