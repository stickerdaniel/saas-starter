import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		bucket: Schema.Literals([
			'supportThreadCreateAnon',
			'supportFileUploadAnon',
			'supportFilePreviewAnon'
		]),
		lowSince: Schema.optional(Schema.Number),
		alertedAt: Schema.optional(Schema.Number)
	})
).index('by_bucket', ['bucket']);
