import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { getActive, savePrompt, setActive } from './promptStore';
import promptStore from './promptStore.spec';

export default GroupImpl.make(databaseSchema, promptStore).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, promptStore, 'getActive', getActive),
		FunctionImpl.make(databaseSchema, promptStore, 'savePrompt', savePrompt),
		FunctionImpl.make(databaseSchema, promptStore, 'setActive', setActive)
	]),
	GroupImpl.finalize
);
