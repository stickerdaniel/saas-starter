import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import { ensureSeededAdmin } from './localDev';
import localDev from './localDev.spec';

export default GroupImpl.make(databaseSchema, localDev).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, localDev, 'ensureSeededAdmin', ensureSeededAdmin)
	]),
	GroupImpl.finalize
);
