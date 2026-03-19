---
name: convex-guidelines
description: Canonical Convex backend coding patterns — validators, function registration, queries, mutations, actions, schemas, pagination, cron jobs, file storage, and Better Auth integration. Use when writing or reviewing any Convex backend code.
---

# Convex Coding Guidelines

These guidelines must be followed when writing, reviewing, or modifying any Convex backend code.

## Function Guidelines

### HTTP Endpoint Syntax

- HTTP endpoints are defined in `convex/http.ts` and require an `httpAction` decorator:

```typescript
import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
const http = httpRouter();
http.route({
	path: '/echo',
	method: 'POST',
	handler: httpAction(async (ctx, req) => {
		const body = await req.bytes();
		return new Response(body, { status: 200 });
	})
});
```

- HTTP endpoints are registered at the exact path you specify in the `path` field.
- For prefix matching use `pathPrefix` instead of `path`: `http.route({ pathPrefix: "/api/", method: "GET", handler: ... })`. Do NOT use glob patterns like `/api/*`.

### Validators

- Use `v.array(validator)` for arrays, `v.union(...)` for unions, and `v.object({ ... })` for objects.
- Discriminated unions: use `v.literal("kind")` inside `v.union(v.object({ kind: v.literal("a"), ... }), ...)`.
- Common validators: `v.id(tableName)`, `v.string()`, `v.number()`, `v.boolean()`, `v.int64()` (not `v.bigint()`), `v.record(keys, values)` (not `v.map`/`v.set`).
- There is NO `v.tuple()` validator. Use `v.array(v.union(...))` for mixed-type arrays.
- JavaScript's `undefined` is not a valid Convex value. Functions that return `undefined` or do not return will return `null` when called from a client. Use `null` instead.
- `v.record(keys, values)`: keys must be ASCII characters, nonempty, and not start with `$` or `_`.

### Function Registration

- Use `internalQuery`, `internalMutation`, `internalAction` for private functions (from `./_generated/server`). Use `query`, `mutation`, `action` for public API.
- Do NOT register functions through the `api` or `internal` objects.
- ALWAYS include `args` validators for every function.
- ALWAYS include `returns` validators for every function. If a function returns nothing, use `returns: v.null()`.
- **Scheduled retry functions MUST have a max retry count.** Add a `retryCount` field to the relevant table and stop retrying after N attempts (typically 5). Log the final failure for observability.

### Function Calling

- Use `ctx.runQuery` to call a query from a query, mutation, or action.
- Use `ctx.runMutation` to call a mutation from a mutation or action.
- Use `ctx.runAction` to call an action from an action.
- Only call an action from another action when crossing runtimes (e.g. V8 to Node). Otherwise extract shared logic into a helper async function.
- Minimize action-to-query/mutation calls; each call is a separate transaction and can introduce race conditions.
- All calls take a FunctionReference (e.g. `api.module.f`). Do NOT pass the function directly.
- For same-file calls, add a type annotation on the return value to avoid TypeScript circularity:

```typescript
export const f = query({
	args: { name: v.string() },
	returns: v.string(),
	handler: async (ctx, args) => {
		return 'Hello ' + args.name;
	}
});

export const g = query({
	args: {},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result: string = await ctx.runQuery(api.example.f, { name: 'Bob' });
		return null;
	}
});
```

### Function References (File-Based Routing)

- Use the `api` object from `convex/_generated/api.ts` to reference public functions (`query`, `mutation`, `action`).
- Use the `internal` object from `convex/_generated/api.ts` to reference private functions (`internalQuery`, `internalMutation`, `internalAction`).
- Public function `f` in `convex/example.ts` → `api.example.f`.
- Private function `g` in `convex/example.ts` → `internal.example.g`.
- Nested directories: `convex/messages/access.ts` → `api.messages.access.h`.

### Pagination

- Import `paginationOptsValidator` from `convex/server` and use `args: { paginationOpts: paginationOptsValidator, ... }`.
- Paginated return object has `page`, `isDone`, and `continueCursor` (NOT `results`).
- Example:

```typescript
import { query } from './_generated/server';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';

export const list = query({
	args: { paginationOpts: paginationOptsValidator, author: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('messages')
			.withIndex('by_author', (q) => q.eq('author', args.author))
			.order('desc')
			.paginate(args.paginationOpts);
	}
});
```

## Schema Guidelines

- Always define your schema in `convex/schema.ts` and import schema definition functions from `convex/server`.
- System fields `_creationTime` (`v.number()`) and `_id` (`v.id(tableName)`) are automatic — never define them manually.
- Include all index fields in the index name: index on `["field1", "field2"]` → name `by_field1_and_field2`.
- Index fields must be queried in the order they are defined. To query in a different order, create a separate index.

## Authentication Guidelines (Better Auth + Convex)

This section applies to projects using `@convex-dev/better-auth` with a local install — NOT vanilla Convex JWT auth (`auth.config.ts` + `ctx.auth.getUserIdentity()`).

### Server-side (Convex Backend)

- Auth is configured via `createAuth()` and `createAuthOptions()`.
- Use `authComponent.getAuthUser(ctx)` to get the current authenticated user in any query, mutation, or action. Returns `null` if unauthenticated.
- NEVER accept a `userId` or any user identifier as a function argument for authorization. Always derive identity server-side via `authComponent.getAuthUser(ctx)`.
- HTTP auth routes are registered via `authComponent.registerRoutes(http, createAuth)` in `convex/http.ts`.
- Auth tables (`user`, `session`, `account`, `verification`, `jwks`, `passkey`) are managed by the Better Auth component.
- Supported auth methods: email/password, OAuth (Google, GitHub), passkeys.

### Client-side (SvelteKit)

- Auth client is created via `createAuthClient()` with plugins: `convexClient()`, `passkeyClient()`, `adminClient()`.
- Use `useAuth()` for reactive auth state (`isAuthenticated`, `session`, `user`).
- Route protection is handled in `hooks.server.ts`: JWT extracted from cookies, `/app/**` requires auth, `/admin/**` requires `role === 'admin'`.
- Sign-in/sign-up: `authClient.signIn.email()`, `authClient.signUp.email()`, `authClient.signIn.social()`, `authClient.signIn.passkey()`.

## TypeScript Guidelines

- Use `Id<"tableName">` from `./_generated/dataModel` for document IDs. Be strict — prefer `Id<"users">` over `string`.
- Use `Doc<"tableName">` from `./_generated/dataModel` for full document types.
- Use `QueryCtx`, `MutationCtx`, `ActionCtx` from `./_generated/server` for typing function contexts. NEVER use `any` for ctx parameters.
- Match `Record` key/value types to the validator: `v.record(v.id('users'), v.string())` → `Record<Id<'users'>, string>`.

## Query Guidelines

- Do NOT use `filter` in queries. Define an index in the schema and use `withIndex` instead.
- Convex queries do NOT support `.delete()`. Instead, `.collect()` the results, iterate, and call `ctx.db.delete(row._id)` on each.
- Use `.unique()` to get a single document. Throws if multiple documents match.
- When using async iteration, do NOT use `.collect()`, `.take(n)`, or `.iter()`. Use `for await (const row of query)` directly.

### Ordering

- By default Convex returns documents in ascending `_creationTime` order.
- Use `.order('asc')` or `.order('desc')` to set order. Defaults to ascending.
- Queries using indexes are ordered based on the index columns and avoid slow table scans.

## Full-Text Search

Use `.withSearchIndex()` for text search queries:

```typescript
const messages = await ctx.db
	.query('messages')
	.withSearchIndex('search_body', (q) => q.search('body', 'hello hi').eq('channel', '#general'))
	.take(10);
```

## Mutation Guidelines

- Use `ctx.db.replace` to fully replace an existing document. Throws if the document does not exist.
- Use `ctx.db.patch` to shallow merge updates into an existing document. Throws if the document does not exist.

## Action Guidelines

- Always add `"use node";` to the top of files containing actions that use Node.js built-in modules.
- NEVER add `"use node";` to a file that also exports queries or mutations. Only actions can run in the Node.js runtime; queries and mutations must stay in the default Convex runtime. If you need Node.js built-ins alongside queries or mutations, put the action in a separate file.
- `fetch()` is available in the default Convex runtime. You do NOT need `"use node";` just to use `fetch()`.
- Never use `ctx.db` inside of an action. Actions don't have access to the database. Use `ctx.runQuery` or `ctx.runMutation` instead.

## Scheduling Guidelines

### Cron Jobs

- Only use `crons.interval` or `crons.cron` methods. Do NOT use `crons.hourly`, `crons.daily`, or `crons.weekly` helpers.
- Both cron methods take a FunctionReference. Do NOT pass the function directly.
- Define crons by declaring the top-level `crons` object, calling methods on it, and exporting it as default:

```typescript
import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';

const empty = internalAction({
	args: {},
	handler: async (ctx, args) => {
		console.log('empty');
	}
});

const crons = cronJobs();
crons.interval('delete inactive users', { hours: 2 }, internal.crons.empty, {});
export default crons;
```

- You can register Convex functions within `crons.ts` just like any other file.
- If a cron calls an internal function, always import `internal` from `_generated/api`, even if the function is registered in the same file.

## File Storage Guidelines

- `ctx.storage.getUrl()` returns a signed URL for a given file. Returns `null` if the file doesn't exist.
- Do NOT use the deprecated `ctx.storage.getMetadata`. Query the `_storage` system table instead:

```typescript
import { query } from './_generated/server';
import { v } from 'convex/values';

export const getFileMetadata = query({
	args: { fileId: v.id('_storage') },
	returns: v.any(),
	handler: async (ctx, args) => {
		return await ctx.db.system.get(args.fileId);
		// Returns: { _id, _creationTime, contentType?, sha256, size }
	}
});
```

- Convex storage stores items as `Blob` objects. Convert all items to/from a `Blob` when using storage.
- Use `new Blob([data])` to store and `await blob.text()` to read. Do NOT use `TextEncoder` or `TextDecoder` with Convex storage blobs.
