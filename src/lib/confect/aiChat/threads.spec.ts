import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { AiChatRefusalCodec, RateLimitedCodec } from '../errorCodecs';
import RequireUser from '../middleware/RequireUser.spec';
import {
	MetadataBackfillSchema,
	StaleWarmSweepSchema,
	ThreadListArgsSchema,
	ThreadListSchema,
	ThreadMetadataArgsSchema,
	ThreadRefSchema,
	ThreadTitleArgsSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'backfillThreadMetadata',
			args: () => ({}),
			returns: () => MetadataBackfillSchema
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'createThread',
			args: () => ({}),
			returns: () => ThreadRefSchema,
			error: () => RateLimitedCodec
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'deleteStaleWarmThreads',
			args: () => ({}),
			returns: () => StaleWarmSweepSchema
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'deleteThread',
			args: () => ThreadRefSchema.fields,
			returns: () => Schema.Null,
			error: () => AiChatRefusalCodec
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'getOrCreateWarmThread',
			args: () => ({}),
			returns: () => ThreadRefSchema,
			error: () => RateLimitedCodec
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getWarmThread',
			args: () => ({}),
			returns: () => Schema.NullOr(ThreadRefSchema)
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listThreads',
			args: () => ThreadListArgsSchema.fields,
			returns: () => ThreadListSchema
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'setThreadTitleIfEmpty',
			args: () => ThreadTitleArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'updateThreadMetadata',
			args: () => ThreadMetadataArgsSchema.fields,
			returns: () => Schema.Null
		})
	);
