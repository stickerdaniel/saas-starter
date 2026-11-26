import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { QueryCtx } from '../_generated/services';
import { createAuth } from '../authServer';
import metadata from './metadata.spec';
import { authorizationServerMetadata } from './resource';

export default GroupImpl.make(databaseSchema, metadata).pipe(
	Layer.provide(
		FunctionImpl.make(databaseSchema, metadata, 'authorizationServer', () =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				const document = yield* Effect.promise(() => createAuth(ctx).api.getOAuthServerConfig());
				return { ...authorizationServerMetadata(document) };
			})
		)
	),
	GroupImpl.finalize
);
