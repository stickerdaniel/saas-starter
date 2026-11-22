import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { previewDraft, queueDraft, saveDraft } from './founderIncidentDrafts';
import founderIncidentDrafts from './founderIncidentDrafts.spec';

export default GroupImpl.make(databaseSchema, founderIncidentDrafts).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, founderIncidentDrafts, 'previewDraft', previewDraft),
		FunctionImpl.make(databaseSchema, founderIncidentDrafts, 'queueDraft', queueDraft),
		FunctionImpl.make(databaseSchema, founderIncidentDrafts, 'saveDraft', saveDraft)
	]),
	GroupImpl.finalize
);
