import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import * as Tool from 'effect/ai/Tool';
import * as Toolkit from 'effect/ai/Toolkit';
import type refs from '../../_generated/refs';
import { QueryRunner } from '../../_generated/services';
import { UnauthenticatedCodec } from '../../errorCodecs';
import { McpPrincipal } from '../access';

export const GetAccount = Tool.make('get_account', {
	description:
		'Returns the signed-in account: its id, name, email address and profile picture URL.',
	success: Schema.Struct({
		userId: Schema.String,
		name: Schema.String,
		email: Schema.String,
		image: Schema.NullOr(Schema.String)
	}),
	failure: UnauthenticatedCodec
})
	.annotate(Tool.Title, 'Get account')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

export const AccountTools = Toolkit.make(GetAccount);

export const AccountToolsLive = (functions: typeof refs) =>
	AccountTools.toLayer(
		Effect.gen(function* () {
			const principal = yield* McpPrincipal;
			const queries = yield* QueryRunner;
			return {
				get_account: () =>
					queries.runQuery(functions.internal.users.viewerAs, { userId: principal.userId }).pipe(
						Effect.map((user) => ({
							userId: user._id,
							name: user.name,
							email: user.email,
							image: user.image ?? null
						})),
						Effect.catchTag('SchemaError', Effect.die)
					)
			};
		})
	);
