import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { generateThreadTitle } from './titles';
import titles from './titles.spec';

export default GroupImpl.make(databaseSchema, titles).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, titles, 'generateThreadTitle', generateThreadTitle)
	]),
	GroupImpl.finalize
);
