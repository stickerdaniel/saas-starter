import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { FileReferenceFields } from '../files/schemas';

export default Table.make(() =>
	Schema.Struct({
		...FileReferenceFields,
		url: Schema.optional(Schema.String),
		width: Schema.optional(Schema.Number),
		height: Schema.optional(Schema.Number),
		createdAt: Schema.Number
	})
)
	.index('by_url', ['url'])
	.index('by_storageId', ['storageId']);
