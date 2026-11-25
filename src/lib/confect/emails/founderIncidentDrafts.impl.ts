import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { Doc } from '../../convex/_generated/dataModel';
import type { QueryCtx as ConvexQueryCtx } from '../../convex/_generated/server';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryCtx } from '../_generated/services';
import {
	enqueueFounderIncidentEmail,
	findFounderIncidentEmail,
	prepareFounderIncidentEmail,
	refuseFounderIncident,
	resolveFounderIncidentContact
} from './founderIncidentCore';
import {
	draftApprovalDigest,
	renderDraftTemplate,
	validateDraftEnvelope,
	validateDraftIncident,
	validateDraftTemplates
} from './founderIncidentDraftContent';
import founderIncidentDrafts from './founderIncidentDrafts.spec';
import { FOUNDER_INCIDENT_REFUSALS } from './founderIncidentErrors';
import { founderIncidentRegistry } from './founderIncidentRegistry';
import type { FounderIncidentTemplate } from './founderIncidentTypes';

type Draft = Doc<'founderIncidentDrafts'>;

async function findDraft(ctx: ConvexQueryCtx, incident: string) {
	validateDraftIncident(incident, founderIncidentRegistry);
	return await ctx.db
		.query('founderIncidentDrafts')
		.withIndex('by_incident', (q) => q.eq('incident', incident))
		.unique();
}

const sameTemplates = (
	existing: readonly FounderIncidentTemplate[],
	canonical: readonly FounderIncidentTemplate[]
) =>
	existing.length === canonical.length &&
	existing.every((template, index) => {
		const other = canonical[index];
		return (
			template.locale === other?.locale &&
			template.subject === other.subject &&
			template.text === other.text
		);
	});

const isRevision = (revision: number | null) =>
	revision === null || (Number.isSafeInteger(revision) && revision >= 1);

const prepareDraft = (ctx: ConvexQueryCtx, draft: Draft, userId: string) =>
	Effect.gen(function* () {
		const prepared = yield* prepareFounderIncidentEmail(
			ctx,
			userId,
			(input) => renderDraftTemplate(draft.templates, input),
			resolveFounderIncidentContact
		);
		if (prepared.status === 'skipped') return prepared;
		yield* Effect.sync(() => validateDraftEnvelope(prepared.envelope));
		const snapshot = {
			incident: draft.incident,
			revision: draft.revision,
			userId,
			locale: prepared.locale,
			envelope: prepared.envelope
		};
		return { status: 'ready' as const, ...snapshot, approvalDigest: draftApprovalDigest(snapshot) };
	});

const requireDraft = (ctx: ConvexQueryCtx, incident: string) =>
	Effect.gen(function* () {
		const draft = yield* Effect.promise(() => findDraft(ctx, incident));
		if (!draft) return yield* refuseFounderIncident(FOUNDER_INCIDENT_REFUSALS.unknownDraft);
		return draft;
	});

export default GroupImpl.make(databaseSchema, founderIncidentDrafts).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			founderIncidentDrafts,
			'previewDraft',
			({ incident, userId }) =>
				Effect.gen(function* () {
					const ctx = yield* QueryCtx;
					const draft = yield* requireDraft(ctx, incident);
					return yield* prepareDraft(ctx, draft, userId);
				})
		),
		FunctionImpl.make(
			databaseSchema,
			founderIncidentDrafts,
			'queueDraft',
			({ incident, userId, approvalDigest }) =>
				Effect.gen(function* () {
					const ctx = yield* MutationCtx;
					const draft = yield* requireDraft(ctx, incident);
					if (yield* Effect.promise(() => findFounderIncidentEmail(ctx, incident, userId))) {
						return { status: 'already_processed' as const };
					}
					const preview = yield* prepareDraft(ctx, draft, userId);
					if (preview.status === 'skipped') return preview;
					if (preview.approvalDigest !== approvalDigest) {
						return yield* refuseFounderIncident(FOUNDER_INCIDENT_REFUSALS.approvalMismatch);
					}
					return yield* Effect.promise(() =>
						enqueueFounderIncidentEmail(ctx, incident, userId, preview)
					);
				})
		),
		FunctionImpl.make(
			databaseSchema,
			founderIncidentDrafts,
			'saveDraft',
			({ incident, expectedRevision, templates }) =>
				Effect.gen(function* () {
					const ctx = yield* MutationCtx;
					if (!isRevision(expectedRevision)) {
						return yield* refuseFounderIncident(FOUNDER_INCIDENT_REFUSALS.invalidExpectedRevision);
					}
					const canonical = yield* Effect.sync(() => validateDraftTemplates(templates));
					const existing = yield* Effect.promise(() => findDraft(ctx, incident));
					if (existing && sameTemplates(existing.templates, canonical)) {
						return { revision: existing.revision };
					}
					if ((existing?.revision ?? null) !== expectedRevision) {
						return yield* refuseFounderIncident(FOUNDER_INCIDENT_REFUSALS.revisionConflict);
					}
					const processed = yield* Effect.promise(() =>
						ctx.db
							.query('founderIncidentEmails')
							.withIndex('by_incident_and_user', (q) => q.eq('incident', incident))
							.first()
					);
					if (processed) {
						return yield* refuseFounderIncident(FOUNDER_INCIDENT_REFUSALS.frozenDraft);
					}

					const now = Date.now();
					const revision = (existing?.revision ?? 0) + 1;
					yield* Effect.promise(() =>
						existing
							? ctx.db.patch('founderIncidentDrafts', existing._id, {
									templates: canonical,
									revision,
									updatedAt: now
								})
							: ctx.db
									.insert('founderIncidentDrafts', {
										incident,
										templates: canonical,
										revision,
										createdAt: now,
										updatedAt: now
									})
									.then(() => undefined)
					);
					return { revision };
				})
		)
	]),
	GroupImpl.finalize
);
