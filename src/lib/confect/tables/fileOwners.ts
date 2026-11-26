import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({ fileId: Schema.String, ownerId: Schema.String })
).index('by_file_and_owner', ['fileId', 'ownerId']);
