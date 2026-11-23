import { Table } from '@confect/core';
import { InternalUserNoteSchema } from '../admin/support/schemas';

export default Table.make(() => InternalUserNoteSchema).index('by_user', ['userId']);
