import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import {
	resolveFounderCancellationBilling,
	resolveFounderFeedbackBilling
} from './founderEmailBilling';
import founderEmailBilling from './founderEmailBilling.spec';

export default GroupImpl.make(databaseSchema, founderEmailBilling).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			founderEmailBilling,
			'resolveFounderCancellationBilling',
			resolveFounderCancellationBilling
		),
		FunctionImpl.make(
			databaseSchema,
			founderEmailBilling,
			'resolveFounderFeedbackBilling',
			resolveFounderFeedbackBilling
		)
	]),
	GroupImpl.finalize
);
