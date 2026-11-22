import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import {
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
import threads from './threads.spec';

export default GroupImpl.make(databaseSchema, threads).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, threads, 'backfillThreadMetadata', backfillThreadMetadata),
		FunctionImpl.make(databaseSchema, threads, 'createThread', createThread),
		FunctionImpl.make(databaseSchema, threads, 'deleteStaleWarmThreads', deleteStaleWarmThreads),
		FunctionImpl.make(databaseSchema, threads, 'deleteThread', deleteThread),
		FunctionImpl.make(databaseSchema, threads, 'getOrCreateWarmThread', getOrCreateWarmThread),
		FunctionImpl.make(databaseSchema, threads, 'getWarmThread', getWarmThread),
		FunctionImpl.make(databaseSchema, threads, 'listThreads', listThreads),
		FunctionImpl.make(databaseSchema, threads, 'setThreadTitleIfEmpty', setThreadTitleIfEmpty),
		FunctionImpl.make(databaseSchema, threads, 'updateThreadMetadata', updateThreadMetadata)
	]),
	GroupImpl.finalize
);
