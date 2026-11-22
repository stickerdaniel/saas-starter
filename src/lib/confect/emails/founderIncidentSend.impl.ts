import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { queueFounderIncidentEmail } from './founderIncidentSend';
import founderIncidentSend from './founderIncidentSend.spec';

export default GroupImpl.make(databaseSchema, founderIncidentSend).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			founderIncidentSend,
			'queueFounderIncidentEmail',
			queueFounderIncidentEmail
		)
	]),
	GroupImpl.finalize
);
