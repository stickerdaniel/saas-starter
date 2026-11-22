import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import {
	getFounderEmailSettings,
	getFounderWelcomeConfig,
	getFounderWelcomeConfigInternal
} from './queries';
import queries from './queries.spec';

export default GroupImpl.make(databaseSchema, queries).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, queries, 'getFounderEmailSettings', getFounderEmailSettings),
		FunctionImpl.make(databaseSchema, queries, 'getFounderWelcomeConfig', getFounderWelcomeConfig),
		FunctionImpl.make(
			databaseSchema,
			queries,
			'getFounderWelcomeConfigInternal',
			getFounderWelcomeConfigInternal
		)
	]),
	GroupImpl.finalize
);
