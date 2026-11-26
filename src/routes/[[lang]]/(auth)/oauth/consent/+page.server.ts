import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import type { PageServerLoad } from './$types';
import { fromPromise, runRequestEffect, ServerRequest } from '#lib/server/effect-runtime.js';
import { recoverWith } from '#lib/server/recovered-failure.js';

const PublicClient = Schema.Struct({
	client_name: Schema.optional(Schema.NullOr(Schema.String))
});
const decodePublicClient = Schema.decodeUnknownOption(PublicClient);

export const load = ((event) =>
	runRequestEffect(
		event,
		Effect.gen(function* () {
			const { url, fetch } = yield* ServerRequest;
			const clientId = url.searchParams.get('client_id');
			if (!clientId || !url.searchParams.has('sig')) return { client: null };
			const query = new URLSearchParams({ client_id: clientId });
			const response = yield* fromPromise(() => fetch(`/api/auth/oauth2/public-client?${query}`));
			if (!response.ok) return { client: null };
			const body: unknown = yield* fromPromise(() => response.json());
			return {
				client: Option.match(decodePublicClient(body), {
					onNone: () => null,
					onSome: ({ client_name }) => ({ name: client_name ?? null })
				})
			};
		}).pipe(recoverWith('[consent] client lookup failed', { client: null }))
	)) satisfies PageServerLoad;
