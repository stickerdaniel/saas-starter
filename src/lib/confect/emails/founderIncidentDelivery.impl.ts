import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { reconcileFounderIncidentEmailDelivery } from './founderIncidentDelivery';
import founderIncidentDelivery from './founderIncidentDelivery.spec';

export default GroupImpl.make(databaseSchema, founderIncidentDelivery).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			founderIncidentDelivery,
			'reconcileFounderIncidentEmailDelivery',
			reconcileFounderIncidentEmailDelivery
		)
	]),
	GroupImpl.finalize
);
