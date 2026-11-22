import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { hasUnreadAdminReply, markThreadRead, unreadAdminReplyCount } from './readState';
import readState from './readState.spec';

export default GroupImpl.make(databaseSchema, readState).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, readState, 'hasUnreadAdminReply', hasUnreadAdminReply),
		FunctionImpl.make(databaseSchema, readState, 'markThreadRead', markThreadRead),
		FunctionImpl.make(databaseSchema, readState, 'unreadAdminReplyCount', unreadAdminReplyCount)
	]),
	GroupImpl.finalize
);
