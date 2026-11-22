import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import { ensurePreviewAdmin } from './previewDev';
import previewDev from './previewDev.spec';

export default GroupImpl.make(databaseSchema, previewDev).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, previewDev, 'ensurePreviewAdmin', ensurePreviewAdmin)
	]),
	GroupImpl.finalize
);
