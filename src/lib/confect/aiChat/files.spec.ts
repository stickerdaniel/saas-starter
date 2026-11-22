import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	checkPreviewAccess,
	generateUploadUrl,
	getAttachmentText,
	requireFileAccess,
	saveUploadedFile
} from './files';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof checkPreviewAccess>()('checkPreviewAccess')
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof generateUploadUrl>()('generateUploadUrl'))
	.addFunction(FunctionSpec.convexPublicAction<typeof getAttachmentText>()('getAttachmentText'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof requireFileAccess>()('requireFileAccess'))
	.addFunction(FunctionSpec.convexPublicAction<typeof saveUploadedFile>()('saveUploadedFile'));
