import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	attach,
	billingPortal,
	cancel,
	check,
	checkout,
	createCustomer,
	createEntity,
	createReferralCode,
	getEntity,
	listProducts,
	query,
	redeemReferralCode,
	setupPayment,
	track,
	usage
} from './autumn';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexPublicAction<typeof attach>()('attach'))
	.addFunction(FunctionSpec.convexPublicAction<typeof billingPortal>()('billingPortal'))
	.addFunction(FunctionSpec.convexPublicAction<typeof cancel>()('cancel'))
	.addFunction(FunctionSpec.convexPublicAction<typeof check>()('check'))
	.addFunction(FunctionSpec.convexPublicAction<typeof checkout>()('checkout'))
	.addFunction(FunctionSpec.convexPublicAction<typeof createCustomer>()('createCustomer'))
	.addFunction(FunctionSpec.convexPublicAction<typeof createEntity>()('createEntity'))
	.addFunction(FunctionSpec.convexPublicAction<typeof createReferralCode>()('createReferralCode'))
	.addFunction(FunctionSpec.convexPublicAction<typeof getEntity>()('getEntity'))
	.addFunction(FunctionSpec.convexPublicAction<typeof listProducts>()('listProducts'))
	.addFunction(FunctionSpec.convexPublicAction<typeof query>()('query'))
	.addFunction(FunctionSpec.convexPublicAction<typeof redeemReferralCode>()('redeemReferralCode'))
	.addFunction(FunctionSpec.convexPublicAction<typeof setupPayment>()('setupPayment'))
	.addFunction(FunctionSpec.convexPublicAction<typeof track>()('track'))
	.addFunction(FunctionSpec.convexPublicAction<typeof usage>()('usage'));
