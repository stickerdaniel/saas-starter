import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import {
	checkPreviewAccess,
	generateUploadUrl,
	getAttachmentText,
	saveUploadedFile
} from './files';
import files from './files.spec';

export default GroupImpl.make(databaseSchema, files).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, files, 'checkPreviewAccess', checkPreviewAccess),
		FunctionImpl.make(databaseSchema, files, 'generateUploadUrl', generateUploadUrl),
		FunctionImpl.make(databaseSchema, files, 'getAttachmentText', getAttachmentText),
		FunctionImpl.make(databaseSchema, files, 'saveUploadedFile', saveUploadedFile)
	]),
	GroupImpl.finalize
);
