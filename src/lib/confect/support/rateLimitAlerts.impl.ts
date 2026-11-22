import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { sampleAnonymousRateLimits } from './rateLimitAlerts';
import rateLimitAlerts from './rateLimitAlerts.spec';

export default GroupImpl.make(databaseSchema, rateLimitAlerts).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			rateLimitAlerts,
			'sampleAnonymousRateLimits',
			sampleAnonymousRateLimits
		)
	]),
	GroupImpl.finalize
);
