import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import { generateUploadUrl, updateProfileImage } from './storage';
import storage from './storage.spec';

export default GroupImpl.make(databaseSchema, storage).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, storage, 'generateUploadUrl', generateUploadUrl),
		FunctionImpl.make(databaseSchema, storage, 'updateProfileImage', updateProfileImage)
	]),
	GroupImpl.finalize
);
