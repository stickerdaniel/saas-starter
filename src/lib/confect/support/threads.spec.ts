import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	backfillThreadMetadata,
	createThread,
	deleteEmptyThreads,
	getAdminAvatars,
	getOrCreateWarmThread,
	getThread,
	getThreadLocale,
	listThreads,
	sweepEmptyThread,
	syncUserProfile,
	updateLastMessage,
	updateNotificationEmail,
	updateThreadHandoff,
	updateThreadMetadata
} from './threads';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof backfillThreadMetadata>()('backfillThreadMetadata')
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof createThread>()('createThread'))
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof deleteEmptyThreads>()('deleteEmptyThreads')
	)
	.addFunction(FunctionSpec.convexPublicQuery<typeof getAdminAvatars>()('getAdminAvatars'))
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof getOrCreateWarmThread>()('getOrCreateWarmThread')
	)
	.addFunction(FunctionSpec.convexPublicQuery<typeof getThread>()('getThread'))
	.addFunction(FunctionSpec.convexInternalQuery<typeof getThreadLocale>()('getThreadLocale'))
	.addFunction(FunctionSpec.convexPublicQuery<typeof listThreads>()('listThreads'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof sweepEmptyThread>()('sweepEmptyThread'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof syncUserProfile>()('syncUserProfile'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof updateLastMessage>()('updateLastMessage'))
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof updateNotificationEmail>()('updateNotificationEmail')
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof updateThreadHandoff>()('updateThreadHandoff')
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof updateThreadMetadata>()('updateThreadMetadata')
	);
