import * as Effect from 'effect/Effect';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import * as Layer from 'effect/Layer';
import type refs from '../_generated/refs';
import { QueryRunner } from '../_generated/services';

const PATH_INSERTION = '/.well-known/oauth-authorization-server/api/auth';
const PATH_APPENDING = '/api/auth/.well-known/oauth-authorization-server';

export const AUTHORIZATION_SERVER_METADATA_PATHS = [PATH_INSERTION, PATH_APPENDING];

const PUBLIC_DOCUMENT_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Cache-Control': 'public, max-age=15, stale-while-revalidate=15, stale-if-error=86400'
};

const preflight = HttpServerResponse.empty({ status: 204, headers: PUBLIC_DOCUMENT_HEADERS });

export const authorizationServerMetadataRoutes = (
	query: typeof refs.internal.oauth.metadata.authorizationServer
) => {
	const document = Effect.gen(function* () {
		const queries = yield* QueryRunner;
		const metadata = yield* queries.runQuery(query, {}).pipe(Effect.orDie);
		return HttpServerResponse.jsonUnsafe(metadata, { headers: PUBLIC_DOCUMENT_HEADERS });
	});
	return Layer.mergeAll(
		HttpRouter.add('GET', PATH_INSERTION, document),
		HttpRouter.add('GET', PATH_APPENDING, document),
		HttpRouter.add('OPTIONS', PATH_INSERTION, preflight),
		HttpRouter.add('OPTIONS', PATH_APPENDING, preflight)
	);
};
