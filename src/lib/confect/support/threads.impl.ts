import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import {
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
import threads from './threads.spec';

export default GroupImpl.make(databaseSchema, threads).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, threads, 'backfillThreadMetadata', backfillThreadMetadata),
		FunctionImpl.make(databaseSchema, threads, 'createThread', createThread),
		FunctionImpl.make(databaseSchema, threads, 'deleteEmptyThreads', deleteEmptyThreads),
		FunctionImpl.make(databaseSchema, threads, 'getAdminAvatars', getAdminAvatars),
		FunctionImpl.make(databaseSchema, threads, 'getOrCreateWarmThread', getOrCreateWarmThread),
		FunctionImpl.make(databaseSchema, threads, 'getThread', getThread),
		FunctionImpl.make(databaseSchema, threads, 'getThreadLocale', getThreadLocale),
		FunctionImpl.make(databaseSchema, threads, 'listThreads', listThreads),
		FunctionImpl.make(databaseSchema, threads, 'sweepEmptyThread', sweepEmptyThread),
		FunctionImpl.make(databaseSchema, threads, 'syncUserProfile', syncUserProfile),
		FunctionImpl.make(databaseSchema, threads, 'updateLastMessage', updateLastMessage),
		FunctionImpl.make(databaseSchema, threads, 'updateNotificationEmail', updateNotificationEmail),
		FunctionImpl.make(databaseSchema, threads, 'updateThreadHandoff', updateThreadHandoff),
		FunctionImpl.make(databaseSchema, threads, 'updateThreadMetadata', updateThreadMetadata)
	]),
	GroupImpl.finalize
);
