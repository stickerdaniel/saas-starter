import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import { attach, billingPortal, checkout, createCustomer } from './autumn';
import autumn from './autumn.spec';

export default GroupImpl.make(databaseSchema, autumn).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, autumn, 'attach', attach),
		FunctionImpl.make(databaseSchema, autumn, 'billingPortal', billingPortal),
		FunctionImpl.make(databaseSchema, autumn, 'checkout', checkout),
		FunctionImpl.make(databaseSchema, autumn, 'createCustomer', createCustomer)
	]),
	GroupImpl.finalize
);
