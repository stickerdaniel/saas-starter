import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { Doc } from '../../convex/_generated/dataModel';
import type { MutationCtx as ConvexMutationCtx } from '../../convex/_generated/server';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryRunner, Scheduler } from '../_generated/services';
import handoff from './handoff.spec';
import {
	acknowledgeUnrepliedTurn,
	findSupportThread,
	markHandedOff,
	saveHandoffAcknowledgement,
	turnLogFields,
	type UnansweredTurn
} from './handoffTurns';

const withMutation = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

const handOffThread = (supportThread: Doc<'supportThreads'>, options: { acknowledge: boolean }) =>
	Effect.gen(function* () {
		if (supportThread.isHandedOff) return false;
		const { threadId } = supportThread;
		yield* withMutation((ctx) => markHandedOff(ctx, supportThread));
		const messageIds = yield* (yield* QueryRunner)
			.runQuery(refs.internal.admin.support.notifications.getRecentUserMessages, { threadId })
			.pipe(Effect.orDie);
		if (options.acknowledge) {
			yield* withMutation((ctx) => saveHandoffAcknowledgement(ctx, supportThread));
		}
		yield* (yield* Scheduler).runAfter(
			Duration.zero,
			refs.internal.admin.support.notifications.scheduleAdminNotification,
			{ threadId, messageIds, isReopen: false, notificationType: 'newTickets' }
		);
		return true;
	});

export const settleUnanswered = (turn: UnansweredTurn) =>
	Effect.gen(function* () {
		const supportThread = yield* withMutation((ctx) => findSupportThread(ctx, turn.threadId));
		if (!supportThread) return;
		if (yield* handOffThread(supportThread, { acknowledge: true })) {
			yield* Effect.logError({ code: 'support_turn_unanswered', ...turnLogFields(turn) });
			return;
		}
		const acknowledged = yield* withMutation((ctx) =>
			acknowledgeUnrepliedTurn(ctx, supportThread, turn.promptMessageId)
		);
		if (acknowledged) {
			yield* Effect.logWarning({
				code: 'support_turn_handoff_without_reply',
				...turnLogFields(turn)
			});
		}
	});

export default GroupImpl.make(databaseSchema, handoff).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, handoff, 'internalSetHandoff', ({ threadId, acknowledge }) =>
			Effect.gen(function* () {
				const supportThread = yield* withMutation((ctx) => findSupportThread(ctx, threadId));
				if (!supportThread) {
					yield* Effect.log(`[internalSetHandoff] No supportThread found for: ${threadId}`);
					return null;
				}
				yield* handOffThread(supportThread, { acknowledge: acknowledge === true });
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, handoff, 'settleUnansweredTurn', (turn) =>
			Effect.gen(function* () {
				yield* settleUnanswered(turn);
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
