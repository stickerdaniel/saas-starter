import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import { cancelUnsentEmails } from './cancel';
import cancel from './cancel.spec';

export default GroupImpl.make(databaseSchema, cancel).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, cancel, 'cancelUnsentEmails', cancelUnsentEmails)
	]),
	GroupImpl.finalize
);
