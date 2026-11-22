import { FunctionSpec, GroupSpec } from '@confect/core';
import type { createAIResponse, getFileMetadataBatch, listMessages, sendMessage } from './messages';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexInternalAction<typeof createAIResponse>()('createAIResponse'))
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof getFileMetadataBatch>()('getFileMetadataBatch')
	)
	.addFunction(FunctionSpec.convexPublicQuery<typeof listMessages>()('listMessages'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof sendMessage>()('sendMessage'));
