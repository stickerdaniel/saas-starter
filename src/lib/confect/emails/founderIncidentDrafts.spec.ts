import { FunctionSpec, GroupSpec } from '@confect/core';
import { FounderIncidentRefusalCodec } from '../errorCodecs';
import {
	DraftRevisionSchema,
	FounderIncidentPreviewSchema,
	FounderIncidentQueueResultSchema,
	PreviewDraftArgsSchema,
	QueueDraftArgsSchema,
	SaveDraftArgsSchema
} from './founderIncidentTypes';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'previewDraft',
			args: () => PreviewDraftArgsSchema.fields,
			returns: () => FounderIncidentPreviewSchema,
			error: () => FounderIncidentRefusalCodec
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'queueDraft',
			args: () => QueueDraftArgsSchema.fields,
			returns: () => FounderIncidentQueueResultSchema,
			error: () => FounderIncidentRefusalCodec
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'saveDraft',
			args: () => SaveDraftArgsSchema.fields,
			returns: () => DraftRevisionSchema,
			error: () => FounderIncidentRefusalCodec
		})
	);
