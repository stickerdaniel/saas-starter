import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../../_generated/schema';
import { readAiChat } from './aiChat';
import aiChat from './aiChat.spec';

export default GroupImpl.make(databaseSchema, aiChat).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, aiChat, 'read', (request) =>
			Effect.gen(function* () {
				return yield* readAiChat(request);
			})
		)
	]),
	GroupImpl.finalize
);
