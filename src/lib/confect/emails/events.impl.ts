import { FunctionImpl, GroupImpl } from '@confect/server';
import type { EmailEvent, EmailId } from '@convex-dev/resend';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { MutationCtx } from '../_generated/services';
import events from './events.spec';
import { applyFounderIncidentEmailEvent } from './founderIncidentDelivery';

function logEvent(id: EmailId, event: EmailEvent) {
	switch (event.type) {
		case 'email.sent':
			return console.log(`Email ${id} sent`);
		case 'email.delivery_delayed':
			return console.warn(`Email ${id} delivery delayed`);
		case 'email.delivered':
			return console.log(`Email ${id} delivered successfully`);
		case 'email.bounced':
			return console.warn(`Email ${id} bounced`);
		case 'email.complained':
			return console.warn(`Email ${id} marked as spam by recipient`);
		case 'email.opened':
			return console.log(`Email ${id} opened by recipient`);
		case 'email.clicked':
			return console.log(`Email ${id} link clicked by recipient`);
		case 'email.failed':
			return console.warn(`Email ${id} failed`);
	}
}

export default GroupImpl.make(databaseSchema, events).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, events, 'handleEmailEvent', ({ id, event }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				yield* Effect.promise(() => applyFounderIncidentEmailEvent(ctx, { id, event }));
				yield* Effect.log('Email event received:', { emailId: id, eventType: event.type });
				yield* Effect.promise(() =>
					ctx.db.insert('emailEvents', {
						emailId: id,
						eventType: event.type,
						timestamp: Date.now(),
						data: event
					})
				);
				logEvent(id, event);
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
