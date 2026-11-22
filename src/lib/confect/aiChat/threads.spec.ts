import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	backfillThreadMetadata,
	createThread,
	deleteStaleWarmThreads,
	deleteThread,
	getOrCreateWarmThread,
	getWarmThread,
	listThreads,
	setThreadTitleIfEmpty,
	updateThreadMetadata
} from './threads';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof backfillThreadMetadata>()('backfillThreadMetadata')
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof createThread>()('createThread'))
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof deleteStaleWarmThreads>()('deleteStaleWarmThreads')
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof deleteThread>()('deleteThread'))
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof getOrCreateWarmThread>()('getOrCreateWarmThread')
	)
	.addFunction(FunctionSpec.convexPublicQuery<typeof getWarmThread>()('getWarmThread'))
	.addFunction(FunctionSpec.convexPublicQuery<typeof listThreads>()('listThreads'))
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof setThreadTitleIfEmpty>()('setThreadTitleIfEmpty')
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof updateThreadMetadata>()('updateThreadMetadata')
	);
