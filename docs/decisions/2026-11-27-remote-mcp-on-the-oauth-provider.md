---
type: decision
date: 2026-11-27
status: historical
---

# Remote MCP runs on the Better Auth OAuth provider and a stateless Convex HTTP route

## Decision

The authorization server is `@better-auth/oauth-provider` inside the existing Better Auth instance, with its tables in the local Better Auth component. It issues opaque access tokens: the provider's JWT plugin stays off.

The MCP endpoint is a Convex HTTP route at `/mcp` on the Convex site origin. Each request checks its bearer token with one internal query, `oauth/access:verify`, which runs the provider's own token validation and then refuses a token without a matching audience, without a current consent for its grant, or of a missing or banned user. The token's scopes are capped by that consent.

The route hands the request to `@modelcontextprotocol/server` in stateless mode, which serves the current protocol revision and the earlier stateless one. Tools are declared once with `effect/ai` `Tool` and grouped in a `Toolkit`, and a small bridge turns that toolkit into an SDK server per request. A tool reaches a feature through an internal `*As` twin that takes the user id from the verified token.

## Why

- The provider plugin implements PKCE, refresh token rotation, dynamic client registration and consent, the most security-sensitive parts of the feature, and keeps users in the one user store the template already has.
- Opaque tokens have one verification path, and every token can be revoked. A JWT access token that Convex auth accepts would authenticate every public Convex function directly, so a connected client could bypass the tool list and its access level.
- Checking the token in one internal query keeps the provider's own validation (hashing, session binding, disabled clients) instead of copying it, and lets the consent act as a ceiling for tokens issued earlier.
- A Convex HTTP action keeps no process-local state and has no session affinity, so the endpoint has to be stateless. Clients still send the earlier protocol revision, and the SDK serves both revisions without an adapter of the template's own.
- A `Tool` declaration carries the input schema, the output schema, the declared failures and the annotations in one place. A declared tool without a handler fails type checking, and the read-only annotation decides the scope a tool needs.

## Rejected alternatives

- Better Auth's `mcp` plugin: the installed Better Auth release no longer ships it.
- A hand-written authorization server on Effect `HttpApi`: it would re-implement PKCE, rotation, registration and consent.
- An external identity provider: a second user store splits identity.
- JWT access tokens accepted by Convex auth, so that `RequireUser` works unchanged: such a token authenticates every public function, and it cannot be revoked.
- Accepting a token without `aud` at the endpoint: the URL that received a token proves nothing about the resource it was issued for.
- Reading the access token table directly with a copied hash function: it copies provider internals such as the hash format, the session binding and the disabled-client check.
- Calling the provider's introspection endpoint over HTTP: it needs a confidential client and a second request to the same deployment.
- A mutation for the token check: it serialises with token writes and gains nothing over comparing `expiresAt` in the route.
- Effect `McpServer.layerHttp`: its sessions live in process memory.
- Effect `McpServer.layerHttpRequestScoped` alone: it serves only the current protocol revision.
- Effect for the current revision plus a hand-written adapter for the earlier one: the template would own a protocol adapter.
- `@modelcontextprotocol/sdk` 1.x: it serves only the earlier revision.
- A separate service or a Convex gateway component: it adds a deployment unit to a template.
- Effect's `McpServer` registry behind the SDK: its `callTool` requires two services that only its own transports supply.
- SDK `registerTool` with zod shapes: a lint rule forbids `zod` imports in the Convex backend code, which uses Effect Schema.
- Declaring `McpPrincipal` and the runners as dependencies on every tool: the handler layer built per request gives the same types without the repetition.
