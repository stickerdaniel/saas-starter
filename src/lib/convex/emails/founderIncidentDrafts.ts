import { ConvexError, v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { internalMutation, internalQuery, type QueryCtx } from '../_generated/server';
import {
	enqueueFounderIncidentEmail,
	findFounderIncidentEmail,
	prepareFounderIncidentEmail
} from './founderIncidentCore';
import {
	draftApprovalDigest,
	renderDraftTemplate,
	validateDraftEnvelope,
	validateDraftIncident,
	validateDraftTemplates
} from './founderIncidentDraftContent';
import { founderIncidentRegistry } from './founderIncidentRegistry';
import { resolveFounderIncidentContact } from './founderIncidentSend';
import {
	founderIncidentPreviewValidator,
	founderIncidentQueueResultValidator,
	founderIncidentTemplateValidator
} from './founderIncidentTypes';

async function findDraft(ctx: QueryCtx, incident: string) {
	validateDraftIncident(incident, founderIncidentRegistry);
	return await ctx.db
		.query('founderIncidentDrafts')
		.withIndex('by_incident', (q) => q.eq('incident', incident))
		.unique();
}

export const saveDraft = internalMutation({
	args: {
		incident: v.string(),
		expectedRevision: v.union(v.null(), v.number()),
		templates: v.array(founderIncidentTemplateValidator)
	},
	returns: v.object({ revision: v.number() }),
	handler: async (ctx, { incident, expectedRevision, templates }) => {
		if (
			expectedRevision !== null &&
			(!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
		) {
			throw new ConvexError('Invalid founder incident expected revision');
		}
		const canonical = validateDraftTemplates(templates);
		const existing = await findDraft(ctx, incident);
		if (
			existing &&
			existing.templates.length === canonical.length &&
			existing.templates.every((template, index) => {
				const other = canonical[index];
				return (
					template.locale === other?.locale &&
					template.subject === other.subject &&
					template.text === other.text
				);
			})
		) {
			return { revision: existing.revision };
		}
		if ((existing?.revision ?? null) !== expectedRevision) {
			throw new ConvexError('Founder incident draft revision conflict');
		}
		const processed = await ctx.db
			.query('founderIncidentEmails')
			.withIndex('by_incident_and_user', (q) => q.eq('incident', incident))
			.first();
		if (processed) throw new ConvexError('Founder incident draft is frozen after processing');

		const now = Date.now();
		const revision = (existing?.revision ?? 0) + 1;
		if (existing) {
			await ctx.db.patch('founderIncidentDrafts', existing._id, {
				templates: canonical,
				revision,
				updatedAt: now
			});
		} else {
			await ctx.db.insert('founderIncidentDrafts', {
				incident,
				templates: canonical,
				revision,
				createdAt: now,
				updatedAt: now
			});
		}
		return { revision };
	}
});

async function prepareDraft(ctx: QueryCtx, draft: Doc<'founderIncidentDrafts'>, userId: string) {
	const prepared = await prepareFounderIncidentEmail(
		ctx,
		userId,
		(input) => renderDraftTemplate(draft.templates, input),
		resolveFounderIncidentContact
	);
	if (prepared.status === 'skipped') return prepared;
	validateDraftEnvelope(prepared.envelope);
	const snapshot = {
		incident: draft.incident,
		revision: draft.revision,
		userId,
		locale: prepared.locale,
		envelope: prepared.envelope
	};
	return { status: 'ready' as const, ...snapshot, approvalDigest: draftApprovalDigest(snapshot) };
}

export const previewDraft = internalQuery({
	args: { incident: v.string(), userId: v.string() },
	returns: founderIncidentPreviewValidator,
	handler: async (ctx, { incident, userId }) => {
		const draft = await findDraft(ctx, incident);
		if (!draft) throw new ConvexError('Unknown founder incident draft');
		return await prepareDraft(ctx, draft, userId);
	}
});

export const queueDraft = internalMutation({
	args: { incident: v.string(), userId: v.string(), approvalDigest: v.string() },
	returns: founderIncidentQueueResultValidator,
	handler: async (ctx, { incident, userId, approvalDigest }) => {
		const draft = await findDraft(ctx, incident);
		if (!draft) throw new ConvexError('Unknown founder incident draft');
		if (await findFounderIncidentEmail(ctx, incident, userId)) {
			return { status: 'already_processed' as const };
		}
		const preview = await prepareDraft(ctx, draft, userId);
		// Unlike legacy skips, an ineligible draft recipient does not consume the key.
		if (preview.status === 'skipped') return preview;
		if (preview.approvalDigest !== approvalDigest) {
			throw new ConvexError('Founder incident approval no longer matches; preview again');
		}
		return await enqueueFounderIncidentEmail(ctx, incident, userId, preview);
	}
});
