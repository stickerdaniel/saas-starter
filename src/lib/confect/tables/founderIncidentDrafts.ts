import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		incident: Schema.String,
		revision: Schema.Number,
		templates: Schema.Array(
			Schema.Struct({ locale: Schema.String, subject: Schema.String, text: Schema.String })
		),
		createdAt: Schema.Number,
		updatedAt: Schema.Number
	})
).index('by_incident', ['incident']);
