import { FunctionSpec, GroupSpec } from '@confect/core';
import type { attach, billingPortal, checkout, createCustomer } from './autumn';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexPublicAction<typeof attach>()('attach'))
	.addFunction(FunctionSpec.convexPublicAction<typeof billingPortal>()('billingPortal'))
	.addFunction(FunctionSpec.convexPublicAction<typeof checkout>()('checkout'))
	.addFunction(FunctionSpec.convexPublicAction<typeof createCustomer>()('createCustomer'));
