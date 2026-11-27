---
type: decision
date: 2026-11-27
status: historical
---

# Remote MCP runs on the Better Auth OAuth provider and Effect's request-scoped MCP layer

## Decision

The authorization server is `@better-auth/oauth-provider` inside the existing Better Auth instance, with its tables in the local Better Auth component. It issues opaque access tokens: the provider's JWT plugin stays off.

The MCP endpoint is a Convex HTTP route at `/mcp` on the Convex site origin. Each request checks its bearer token with one internal query, `oauth/access:verify`, which runs the provider's own token validation and then refuses a token without a matching audience, without a current consent for its grant, or of a missing or banned user. The token's scopes are capped by that consent.

The route serves Effect's `McpServer.layerHttpRequestScoped` with the protocol revision `2026-07-28` alone. The repository holds no package of the MCP TypeScript SDK and no patch of `effect`. Tools are declared once with `effect/ai` `Tool`, grouped in a `Toolkit` and registered with the layer. A guard in front of the layer answers the origin check, the bearer check, the body limit and the `insufficient_scope` challenge, and provides the request's principal. A tool reaches a feature through an internal `*As` twin that takes the user id from the verified token.

## Why

- The provider plugin implements PKCE, refresh token rotation, dynamic client registration and consent, the most security-sensitive parts of the feature, and keeps users in the one user store the template already has.
- Opaque tokens have one verification path, and every token can be revoked. A JWT access token that Convex auth accepts would authenticate every public Convex function directly, so a connected client could bypass the tool list and its access level.
- Checking the token in one internal query keeps the provider's own validation (hashing, session binding, disabled clients) instead of copying it, and lets the consent act as a ceiling for tokens issued earlier.
- The backend is written in Effect, and Effect's MCP server serves the current revision natively. A second MCP library earns its place only where it is much better.
- A Convex HTTP action keeps no process-local state and has no session affinity. The request-scoped layer runs one MCP server per request and leaves nothing behind after the response.
- A `Tool` declaration carries the input schema, the output schema, the declared failures, the annotations and the request services its handler reads in one place. A declared tool without a handler fails type checking, and the read-only annotation decides the scope a tool needs.

## Constraints

- The layer is built when Convex loads the HTTP module. Registering the toolkit schedules a notification through Effect's scheduler, and the default scheduler calls `setTimeout`, which Convex refuses at import time: every route of the module then answers HTTP 500. The layer therefore gets `Scheduler.MixedScheduler('sync')`. A tool handler runs on that scheduler, which does not yield to the event loop.
- A declared failure reaches the model as its `message`, or as its encoded fields when it has no message. A defect reaches the model as `Tool execution failed due to an internal server error.` and the deployment log as its cause.
- On Convex cloud a client sees no response header before the first body byte, so a client's header timeout covers the whole run of a tool. A long operation belongs in one tool that starts it and one that reads its state.
- Convex cloud turns an answer sent before the request body was read into a Cloudflare 520. The guard reads and discards the rest of the body before it refuses a request.

## Known cost

Measured on 2026-11-27, Claude Code 2.1.331 and the ChatGPT connector (`openai-mcp/1.0.0`) speak `2026-07-28` and work. The claude.ai connector checks a server with `initialize` of `2025-11-25`, Codex 0.172.0 sends `initialize` of `2025-06-18`, and the Cursor CLI 2026.11.19 sends `initialize` of `2025-11-25`. Each gets HTTP 400: `{"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"MCP-Protocol-Version header is required"}}` without the version header, `{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Required request metadata is missing"}}` with the header `2025-11-25`.

Earlier revisions join by configuration once a released version of `effect` serves them in the request-scoped layer. That is the change of `Effect-TS/effect` pull request 10075, "Serve legacy MCP adapters stateless on layerHttpRequestScoped". A merge without a release changes nothing.

## Rejected alternatives

- Better Auth's `mcp` plugin: the installed Better Auth release no longer ships it.
- A hand-written authorization server on Effect `HttpApi`: it would re-implement PKCE, rotation, registration and consent.
- An external identity provider: a second user store splits identity.
- JWT access tokens accepted by Convex auth, so that `RequireUser` works unchanged: such a token authenticates every public function, and it cannot be revoked.
- Accepting a token without `aud` at the endpoint: the URL that received a token proves nothing about the resource it was issued for.
- Reading the access token table directly with a copied hash function: it copies provider internals such as the hash format, the session binding and the disabled-client check.
- Calling the provider's introspection endpoint over HTTP: it needs a confidential client and a second request to the same deployment.
- A mutation for the token check: it serialises with token writes and gains nothing over comparing `expiresAt` in the route.
- The server package 2.4.0 of the MCP TypeScript SDK in stateless mode, which also serves `2025-11-25`: a second MCP library beside Effect for the earlier revision alone.
- A patch of `effect` that carries the unreleased upstream change: the template would ship unreleased upstream work.
- Effect `McpServer.layerHttp` with `2025-11-25`: its sessions live in process memory. On a deployed Convex action every request after `initialize` gets HTTP 404.
- A hand-written stateless adapter for the earlier revisions: the template would own a protocol adapter.
- The MCP TypeScript SDK 1.x: it serves only the earlier revisions.
- A separate service or a Convex gateway component: it adds a deployment unit to a template.
- A tool handler layer that reads the principal once when it is built: the registry outlives a request, so a captured principal would serve every later caller.
- A scope check derived from the tool annotations in a second place: the 403 check and the tool list ask the same `McpAccess` rule, so a downstream rule applies to both.
