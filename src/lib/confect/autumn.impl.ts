import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import {
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
import autumn from './autumn.spec';

export default GroupImpl.make(databaseSchema, autumn).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, autumn, 'attach', attach),
		FunctionImpl.make(databaseSchema, autumn, 'billingPortal', billingPortal),
		FunctionImpl.make(databaseSchema, autumn, 'cancel', cancel),
		FunctionImpl.make(databaseSchema, autumn, 'check', check),
		FunctionImpl.make(databaseSchema, autumn, 'checkout', checkout),
		FunctionImpl.make(databaseSchema, autumn, 'createCustomer', createCustomer),
		FunctionImpl.make(databaseSchema, autumn, 'createEntity', createEntity),
		FunctionImpl.make(databaseSchema, autumn, 'createReferralCode', createReferralCode),
		FunctionImpl.make(databaseSchema, autumn, 'getEntity', getEntity),
		FunctionImpl.make(databaseSchema, autumn, 'listProducts', listProducts),
		FunctionImpl.make(databaseSchema, autumn, 'query', query),
		FunctionImpl.make(databaseSchema, autumn, 'redeemReferralCode', redeemReferralCode),
		FunctionImpl.make(databaseSchema, autumn, 'setupPayment', setupPayment),
		FunctionImpl.make(databaseSchema, autumn, 'track', track),
		FunctionImpl.make(databaseSchema, autumn, 'usage', usage)
	]),
	GroupImpl.finalize
);
