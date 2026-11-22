import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { continueFounderEmailErasure, eraseFounderEmailPage } from './founderEmailErasure';
import founderEmailErasure from './founderEmailErasure.spec';

export default GroupImpl.make(databaseSchema, founderEmailErasure).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			founderEmailErasure,
			'continueFounderEmailErasure',
			continueFounderEmailErasure
		),
		FunctionImpl.make(
			databaseSchema,
			founderEmailErasure,
			'eraseFounderEmailPage',
			eraseFounderEmailPage
		)
	]),
	GroupImpl.finalize
);
