import { FunctionSpec, GroupSpec } from '@confect/core';
import type { previewDraft, queueDraft, saveDraft } from './founderIncidentDrafts';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexInternalQuery<typeof previewDraft>()('previewDraft'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof queueDraft>()('queueDraft'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof saveDraft>()('saveDraft'));
