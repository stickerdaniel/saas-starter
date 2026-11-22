import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import {
	setFounderEmailEnabled,
	stepDown,
	updateConfig,
	updateFounderEmailTemplate
} from './mutations';
import mutations from './mutations.spec';

export default GroupImpl.make(databaseSchema, mutations).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, mutations, 'setFounderEmailEnabled', setFounderEmailEnabled),
		FunctionImpl.make(databaseSchema, mutations, 'stepDown', stepDown),
		FunctionImpl.make(databaseSchema, mutations, 'updateConfig', updateConfig),
		FunctionImpl.make(
			databaseSchema,
			mutations,
			'updateFounderEmailTemplate',
			updateFounderEmailTemplate
		)
	]),
	GroupImpl.finalize
);
