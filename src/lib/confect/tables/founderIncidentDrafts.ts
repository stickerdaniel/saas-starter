import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { FounderIncidentTemplateSchema } from '../emails/founderIncidentTypes';

export default Table.make(() =>
	Schema.Struct({
		incident: Schema.String,
		revision: Schema.Number,
		templates: Schema.Array(FounderIncidentTemplateSchema),
		createdAt: Schema.Number,
		updatedAt: Schema.Number
	})
).index('by_incident', ['incident']);
