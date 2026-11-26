import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import * as Tool from 'effect/ai/Tool';
import * as Toolkit from 'effect/ai/Toolkit';
import type refs from '../../_generated/refs';
import { MutationRunner, QueryRunner } from '../../_generated/services';
import { CommunityRefusalCodec, RateLimitedCodec, UnauthenticatedCodec } from '../../errorCodecs';
import { McpPrincipal } from '../access';

export const ListCommunityMessages = Tool.make('list_community_messages', {
	description: 'Lists the latest 100 messages of the community chat, oldest first.',
	success: Schema.Struct({
		messages: Schema.Array(
			Schema.Struct({
				messageId: Schema.String,
				userId: Schema.String,
				author: Schema.String,
				body: Schema.String,
				sentAt: Schema.Finite
			})
		)
	}),
	failure: UnauthenticatedCodec
})
	.annotate(Tool.Title, 'List community messages')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

export const PostCommunityMessage = Tool.make('post_community_message', {
	description: 'Posts one message to the community chat as the signed-in user.',
	parameters: Schema.Struct({ body: Schema.String }),
	success: Schema.Struct({ messageId: Schema.String }),
	failure: Schema.Union([CommunityRefusalCodec, RateLimitedCodec, UnauthenticatedCodec])
})
	.annotate(Tool.Title, 'Post community message')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false);

export const CommunityTools = Toolkit.make(ListCommunityMessages, PostCommunityMessage);

export const CommunityToolsLive = (functions: typeof refs) =>
	CommunityTools.toLayer(
		Effect.gen(function* () {
			const principal = yield* McpPrincipal;
			const queries = yield* QueryRunner;
			const mutations = yield* MutationRunner;
			return {
				list_community_messages: () =>
					queries.runQuery(functions.internal.messages.listAs, { userId: principal.userId }).pipe(
						Effect.map((messages) => ({
							messages: messages.map((message) => ({
								messageId: message._id,
								userId: message.userId,
								author: message.author,
								body: message.body,
								sentAt: message._creationTime
							}))
						})),
						Effect.catchTag('SchemaError', Effect.die)
					),
				post_community_message: ({ body }) =>
					mutations
						.runMutation(functions.internal.messages.sendAs, { userId: principal.userId, body })
						.pipe(Effect.catchTag('SchemaError', Effect.die))
			};
		})
	);
