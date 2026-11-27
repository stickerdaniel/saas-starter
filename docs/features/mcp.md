# Remote MCP

Users connect an MCP app such as Claude Code or ChatGPT to their account. The app signs the user in through the template's own OAuth authorization server, the user picks what the app may do, and the app then calls tools that act as that user. The user sees each connection in the settings and can revoke it there.

## What ships

- **The endpoint.** `/mcp` on the Convex site URL, or on `MCP_PUBLIC_ORIGIN` when that variable is set. It serves the MCP protocol revision `2026-07-28` and no earlier revision. A request without a valid bearer token gets HTTP 401 with a `WWW-Authenticate` challenge that points to the protected resource metadata.
- **Two metadata documents.** The protected resource metadata at `/.well-known/oauth-protected-resource/mcp` (also at `/.well-known/oauth-protected-resource`) names the resource URL, the authorization server and the scopes `mcp:read`, `mcp:write` and `offline_access`. The authorization server metadata at `/.well-known/oauth-authorization-server/api/auth` on the app's origin names the authorization, token and registration endpoints. Clients find both on their own from the 401 challenge.
- **Three demo tools.** `get_account` returns the user's id, name, email address and profile picture. `list_community_messages` returns the latest 100 messages of the community chat. `post_community_message` posts a message to the community chat as the user.
- **Two access scopes.** `mcp:read` lets an app use the read-only tools. `mcp:write` together with `mcp:read` lets it use every tool. A client that also asks for `offline_access` gets a refresh token.
- **Consent.** The consent page lists each tool as one sentence under View or Change. When the app asked for `mcp:write`, the user can untick the change line and give view-only access.
- **Settings.** The Apps tab at `/app/settings?tab=apps` shows the MCP URL with a copy button, one block per connected app with its access level, its last use in days and the date it connected, and a Revoke button.

## Clients

The endpoint runs on Effect's request-scoped MCP layer, which serves only the sessionless revision `2026-07-28`. Measured on 2026-11-27:

| Client                                 | What it sends                                                  | Result                                                            |
| -------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Claude Code 2.1.331                    | `server/discover` with `2026-07-28`                            | connects, lists and calls tools                                   |
| ChatGPT connector (`openai-mcp/1.0.0`) | `server/discover` with `2026-07-28`                            | connects, lists and calls tools                                   |
| claude.ai connector                    | its add and connect check sends `initialize` with `2025-11-25` | HTTP 400 at the check, the page shows "Couldn't check the server" |
| Codex 0.172.0                          | `initialize` with `2025-06-18`                                 | HTTP 400, no tool                                                 |
| Cursor CLI 2026.11.19                  | `initialize` with `2025-11-25`                                 | HTTP 400, "Connection failed"                                     |

The origin check comes first, then the bearer check. A request from a foreign origin gets HTTP 403. An `OPTIONS` request from the app's own origin or without an `Origin` header gets HTTP 204 without a token. A `POST`, `GET` or `DELETE` without a valid token gets the 401 challenge whatever it carries. Past both checks, the `initialize` of an earlier revision, sent with `Content-Type: application/json` and `Accept: application/json, text/event-stream`, gets HTTP 400 with a JSON-RPC error in the body, whose `id` repeats the id of the request:

- `initialize` without the `MCP-Protocol-Version` header: `{"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"MCP-Protocol-Version header is required"}}`
- `initialize` with the header `2025-11-25`: `{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Required request metadata is missing"}}`

Past both checks, `GET` and `DELETE` get HTTP 405 with `Allow: POST`.

Earlier revisions can join by configuration once a released version of `effect` serves them in `McpServer.layerHttpRequestScoped`. The upstream change is `Effect-TS/effect` pull request 10075, "Serve legacy MCP adapters stateless on layerHttpRequestScoped". A merge without a release changes nothing. With such a release, the adapters of the earlier revisions join `protocols` in [`endpoint.ts`](../../src/lib/confect/mcp/endpoint.ts). Effect's long-lived `McpServer.layerHttp` does not help on Convex: its sessions live in process memory, and on a deployed Convex HTTP action every request after `initialize` gets HTTP 404.

## Adding a tool

1. Declare the tool with `Tool.make` from `effect/ai` in a file under [`src/lib/confect/mcp/tools/`](../../src/lib/confect/mcp/tools/). List `McpPrincipal` and the runners its handler uses under `dependencies`, group the tool in a `Toolkit`, and give the toolkit a handler layer.
2. Give the backend function the tool calls an internal twin named `<function>As`. The twin takes a `userId`, loads that user with `actingUser(userId)` from [`RequireUser.impl.ts`](../../src/lib/confect/middleware/RequireUser.impl.ts), and runs the same Effect as the public function. A missing or banned user fails with `Unauthenticated`.
3. Add the toolkit to `AppToolkit` and its handler layer to `AppToolkitLive` in [`toolkit.ts`](../../src/lib/confect/mcp/toolkit.ts).
4. Add an entry to [`src/lib/mcp/capabilities.ts`](../../src/lib/mcp/capabilities.ts), with level `view` for a read-only tool and `change` for any other, and add its sentence under `mcp.capability.<tool name>` to all four files in `src/i18n/`.

`src/lib/confect/mcp/capabilities.test.ts` in the full template fails until every tool of `AppToolkit` has exactly one entry at the level its annotation implies and every locale has its sentence.

The demo tool `get_account` shows the shape:

```ts
export const GetAccount = Tool.make('get_account', {
	description:
		'Returns the signed-in account: its id, name, email address and profile picture URL.',
	success: Schema.Struct({
		userId: Schema.String,
		name: Schema.String,
		email: Schema.String,
		image: Schema.NullOr(Schema.String)
	}),
	failure: UnauthenticatedCodec,
	dependencies: [McpPrincipal, QueryRunner]
})
	.annotate(Tool.Title, 'Get account')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

export const AccountTools = Toolkit.make(GetAccount);
```

The tool registry is built once when the deployment loads the HTTP module and serves every request. A handler therefore reads `McpPrincipal` and the runners inside its own Effect, on every call. It reads the user through `users:viewerAs` with the id of the token's user. A tool never receives a user id from the client.

A handler runs on Effect's synchronous scheduler, which does not yield to the event loop. A handler awaits I/O such as a query or a mutation and runs no long CPU-bound loop.

## Tool results and errors

- A success returns the encoded value as `structuredContent` and the same value as one JSON text block.
- A declared failure returns `isError: true` with one text block: the failure's `message` when it has a non-empty one, else its encoded fields as JSON. Both reach the model, so a tool declares only failures whose fields and message the model may read. Give a failure a `message` to send prose instead of its fields.
- A defect or an undeclared failure returns `isError: true` with the text `Tool execution failed due to an internal server error.` The cause goes to the deployment log at level ERROR and never to the client.

## Access rule

A tool annotated `Tool.Readonly` needs `mcp:read`. Every other tool needs `mcp:read` and `mcp:write`. A tool without the annotation counts as a write. A token lists only the tools its scopes allow. A `tools/call` for any other tool, sent with the literal tool name in the `Mcp-Name` header, gets HTTP 403 with an `insufficient_scope` challenge before the tool runs. Any other call of a hidden tool gets the JSON-RPC error `-32602` in an HTTP 200, and its handler does not run either. The scopes a token carries are capped by the user's current consent, so narrowing the consent also narrows tokens issued before.

The rule is the `McpAccess` service in [`access.ts`](../../src/lib/confect/mcp/access.ts), and the 403 check and the tool list both ask it. A downstream with a rule that is no OAuth scope passes its own `McpAccess` layer as `access` to `mcpRoutes`. A tool that rule refuses is hidden, and a call of it gets the JSON-RPC error `-32602`.

## Connections

- Signing out ends no connection. Access tokens issued in that browser session stop working, and a client with a refresh token gets a new access token from it.
- Revoke in the Apps tab ends the connection. Every token of that app stops working, and the app has to go through consent again.
- Narrowing a connection on the consent page also stops the refresh token of the wider grant.
- When a client presents a refresh token that was already used, or presents it again after Revoke or a narrowing refused it once, the authorization server deletes every refresh token of that app for that user and the access tokens issued with them. The user then connects the app again.
- Revoking one app asks every other app of that user for consent again on its next authorization. Once an app has authorized again, the tokens it held before stop working.

## Client registration

Any caller can register a client through dynamic client registration without signing in. One deployment-wide limit of 60 registrations per clock hour applies. When it is used up, registration answers HTTP 429 with `too_many_requests` until the next hour starts. Existing connections and their tokens keep working, because the limit applies only to the registration endpoint.

The consent page shows the name the client chose at registration, or "An app" when it chose none.

## Long-running tools

Convex cloud sends no response header before the first byte of the body, so a client's header timeout covers the whole run of a tool. A slow tool can meet that timeout. Put a long operation into one tool that starts it and one tool that reads its state.

## Request body

A `POST` that passes the origin check and the bearer check with a body over 1,048,576 bytes gets HTTP 413. Both checks come first: the same body gets 403 from a foreign origin and 401 without a valid token. Before the endpoint answers 403, 401 or 413, it reads and discards the body, up to 16 MiB, because on Convex cloud a 401 that left a declared body unread reached the client as a Cloudflare 520 in 10 of 10 runs. One case differs: a chunked body is cancelled after the first chunk that takes the total over the limit, and its 413 leaves without the rest.

## Configuration

- `MCP_PUBLIC_ORIGIN` (Convex backend, optional): the origin of the endpoint when Convex HTTP actions are served under a custom domain. It changes the resource URL in the protected resource metadata, the metadata URL in the 401 challenge, the resource new clients are linked to at registration, and the URL the Apps tab shows. The endpoint accepts tokens for both the Convex site URL and this origin.
- Browser origins: a request without an `Origin` header proceeds, a request from the app's own origin gets CORS headers on every response, an internal error (HTTP 500) included, and any other origin gets HTTP 403. Add further origins to `ALLOWED_BROWSER_ORIGINS` in [`src/lib/confect/oauth/resource.ts`](../../src/lib/confect/oauth/resource.ts).
- `post_community_message` runs the same code as the community chat, so it needs [billing](billing.md) configured. Without it the tool returns `Tool execution failed due to an internal server error.`

## Where to start in the code

- [`src/lib/confect/mcp/endpoint.ts`](../../src/lib/confect/mcp/endpoint.ts): the MCP layer, the guard in front of it (origin, bearer check, last use, body limit, scope check) and the protected resource metadata
- [`src/lib/confect/mcp/toolkit.ts`](../../src/lib/confect/mcp/toolkit.ts) and [`tools/`](../../src/lib/confect/mcp/tools/): the tools
- [`src/lib/confect/oauth/`](../../src/lib/confect/oauth/): the authorization server options, the token check and the connections
- [Consent page](../../src/routes/%5B%5Blang%5D%5D/%28auth%29/oauth/consent/) and [Apps tab](../../src/routes/%5B%5Blang%5D%5D/app/settings/connected-apps-settings.svelte)
- [Decision record](../decisions/2026-11-27-remote-mcp-on-the-oauth-provider.md): why the endpoint is built this way
