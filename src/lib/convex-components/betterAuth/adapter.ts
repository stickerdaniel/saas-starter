import { createApi } from '@convex-dev/better-auth';
import schema from './schema';
import { createAuthOptions } from '../../confect/authServer';

export const {
	create,
	findOne,
	findMany,
	updateOne,
	updateMany,
	deleteOne,
	deleteMany,
	consumeOne,
	incrementOne
} = createApi(schema, createAuthOptions);
