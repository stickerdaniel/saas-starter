import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	createAIResponse,
	createAssistantMessage,
	ensureSupportTurnSettled,
	getFileMetadataBatch,
	getTurnOutcome,
	listMessages,
	sendMessage
} from './messages';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexInternalAction<typeof createAIResponse>()('createAIResponse'))
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof createAssistantMessage>()('createAssistantMessage')
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof ensureSupportTurnSettled>()(
			'ensureSupportTurnSettled'
		)
	)
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof getFileMetadataBatch>()('getFileMetadataBatch')
	)
	.addFunction(FunctionSpec.convexInternalQuery<typeof getTurnOutcome>()('getTurnOutcome'))
	.addFunction(FunctionSpec.convexPublicQuery<typeof listMessages>()('listMessages'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof sendMessage>()('sendMessage'));
