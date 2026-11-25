import { FunctionImpl, GroupImpl } from '@confect/server';
import type { EmailId } from '@convex-dev/resend';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { MutationCtx } from '../_generated/services';
import {
	mergeFounderIncidentDeliveryStatus,
	terminalDeliveryStatuses
} from './founderIncidentDelivery';
import founderIncidentDelivery from './founderIncidentDelivery.spec';
import { resend } from './resend';

export default GroupImpl.make(databaseSchema, founderIncidentDelivery).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			founderIncidentDelivery,
			'reconcileFounderIncidentEmailDelivery',
			({ userId, incident }) =>
				Effect.gen(function* () {
					const ctx = yield* MutationCtx;
					const incidentEmail = yield* Effect.promise(() =>
						ctx.db
							.query('founderIncidentEmails')
							.withIndex('by_incident_and_user', (q) =>
								q.eq('incident', incident).eq('userId', userId)
							)
							.unique()
					);
					if (!incidentEmail) return { status: 'not_found' as const };
					if (incidentEmail.status === 'skipped') return { status: 'skipped' as const };

					const emailId = incidentEmail.emailId;
					const snapshot = emailId
						? yield* Effect.promise(() => resend.status(ctx, emailId as EmailId))
						: null;
					const complained = Boolean(incidentEmail.complainedAt || snapshot?.complained);
					const now = Date.now();
					const current = incidentEmail.deliveryStatus;

					if (!snapshot && current && terminalDeliveryStatuses.has(current)) {
						return { status: 'reconciled' as const, deliveryStatus: current, complained };
					}

					const deliveryStatus = snapshot
						? mergeFounderIncidentDeliveryStatus(current, snapshot.status)
						: 'unknown';
					yield* Effect.promise(() =>
						ctx.db.patch('founderIncidentEmails', incidentEmail._id, {
							deliveryStatus,
							deliveryUpdatedAt: now,
							...(!incidentEmail.complainedAt && snapshot?.complained ? { complainedAt: now } : {})
						})
					);
					return { status: 'reconciled' as const, deliveryStatus, complained };
				})
		)
	]),
	GroupImpl.finalize
);
