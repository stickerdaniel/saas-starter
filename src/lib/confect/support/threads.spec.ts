import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { SupportRefusalCodec } from '../errorCodecs';
import VisitorAccess from '../middleware/VisitorAccess.spec';
import {
	AdminAvatarsSchema,
	BackfillResultSchema,
	NotificationEmailArgsSchema,
	OwnedThreadSchema,
	OwnerThreadSchema,
	ProfileSyncArgsSchema,
	SweepArgsSchema,
	SweepRunSchema,
	ThreadAccessArgsSchema,
	ThreadCreateArgsSchema,
	ThreadHandoffArgsSchema,
	ThreadIdArgsSchema,
	ThreadListArgsSchema,
	ThreadListSchema,
	ThreadMetadataArgsSchema,
	WarmThreadArgsSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'backfillThreadMetadata',
			args: () => ({}),
			returns: () => BackfillResultSchema
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'createThread',
			args: () => ThreadCreateArgsSchema.fields,
			returns: () => OwnedThreadSchema,
			error: () => SupportRefusalCodec
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'deleteEmptyThreads',
			args: () => ({}),
			returns: () => SweepRunSchema
		})
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getAdminAvatars',
			args: () => ({}),
			returns: () => AdminAvatarsSchema
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'getOrCreateWarmThread',
			args: () => WarmThreadArgsSchema.fields,
			returns: () => OwnedThreadSchema,
			error: () => SupportRefusalCodec
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getThread',
			args: () => ThreadAccessArgsSchema.fields,
			returns: () => OwnerThreadSchema,
			error: () => SupportRefusalCodec
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'getThreadLocale',
			args: () => ThreadIdArgsSchema.fields,
			returns: () => Schema.String
		})
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listThreads',
			args: () => ThreadListArgsSchema.fields,
			returns: () => ThreadListSchema
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sweepEmptyThread',
			args: () => SweepArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'syncUserProfile',
			args: () => ProfileSyncArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'updateLastMessage',
			args: () => ThreadIdArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'updateNotificationEmail',
			args: () => NotificationEmailArgsSchema.fields,
			returns: () => Schema.Boolean,
			error: () => SupportRefusalCodec
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'updateThreadHandoff',
			args: () => ThreadHandoffArgsSchema.fields,
			returns: () => Schema.Boolean,
			error: () => SupportRefusalCodec
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'updateThreadMetadata',
			args: () => ThreadMetadataArgsSchema.fields,
			returns: () => Schema.Null
		})
	);
