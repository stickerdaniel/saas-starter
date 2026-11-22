import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { internalSetHandoff, settleUnansweredTurn } from './handoff';
import handoff from './handoff.spec';

export default GroupImpl.make(databaseSchema, handoff).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, handoff, 'internalSetHandoff', internalSetHandoff),
		FunctionImpl.make(databaseSchema, handoff, 'settleUnansweredTurn', settleUnansweredTurn)
	]),
	GroupImpl.finalize
);
