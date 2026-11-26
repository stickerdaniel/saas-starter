import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() => Schema.Struct({ fileId: Schema.String, ownerId: Schema.String }))
	.index('by_fileId_and_ownerId', ['fileId', 'ownerId'])
	.index('by_ownerId', ['ownerId']);
