import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { getSentFounderWelcome, isFounderEmailSendPending } from './founderEmailLedger';
import founderEmailLedger from './founderEmailLedger.spec';

export default GroupImpl.make(databaseSchema, founderEmailLedger).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			founderEmailLedger,
			'getSentFounderWelcome',
			getSentFounderWelcome
		),
		FunctionImpl.make(
			databaseSchema,
			founderEmailLedger,
			'isFounderEmailSendPending',
			isFounderEmailSendPending
		)
	]),
	GroupImpl.finalize
);
