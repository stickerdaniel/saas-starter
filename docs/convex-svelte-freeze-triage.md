# Convex-Svelte Freeze Bug Triage

## Problem

Any Convex WebSocket subscription to `aiChat/threads:listThreads` (which returns an array of objects) freezes the browser when the result is written to any Svelte reactive state (`$state`, `$state.raw`, or plain variable) that feeds the template.

The freeze is a **hard lock** — no JS execution possible, "Page Unresponsive" dialog appears.

## What Works vs What Freezes

| Approach                                                             | Freezes? | Notes                                          |
| -------------------------------------------------------------------- | -------- | ---------------------------------------------- |
| No Convex queries                                                    | No       | Baseline — hardcoded empty arrays              |
| `useQuery(api.users.viewer)` — scalar result                         | No       | Simple object, no array                        |
| `useQuery(api.aiChat.threads.getWarmThread)` — `{threadId}` or null  | No       | Simple object, no array                        |
| `useQuery(api.aiChat.threads.listThreads)` — data NOT read           | No       | Subscription active but `.data` never accessed |
| `useQuery(api.aiChat.threads.listThreads)` — data read in `$derived` | **YES**  | Freezes within seconds                         |
| `usePaginatedQuery(api.aiChat.threads.listThreads)`                  | **YES**  | Same underlying issue                          |
| `client.onUpdate()` — callback does nothing                          | No       | Subscription fires but no state writes         |
| `client.onUpdate()` + write to `$state.raw`                          | **YES**  | Even with `structuredClone`                    |
| `client.onUpdate()` + write to `$state.raw` + JSON dedup             | **YES**  | JSON.stringify can't keep up                   |
| `client.onUpdate()` + `requestAnimationFrame` throttle               | **YES**  | rAF never fires (sync loop)                    |
| `onMount` + `client.onUpdate()` + `$state.raw`                       | **YES**  | Non-reactive context doesn't help              |
| `ConvexHttpClient.query()` (HTTP polling)                            | No       | Stateless HTTP, no WebSocket                   |

## Key Observations

1. **The subscription itself is fine** — `onUpdate` callbacks fire normally when we don't write to state
2. **Writing to ANY Svelte state freezes** — even `$state.raw` with `structuredClone`
3. **The freeze is synchronous** — `requestAnimationFrame` never fires
4. **Scalar queries work** — only array-returning queries freeze
5. **The query only fires ~6 times on the backend** — it's not a server-side loop
6. **The `onUpdate` callback fires only once initially** — confirmed via counter logging

## Root Cause (RESOLVED)

**Zero-width Unicode characters** (`\u200B`–`\u200D`, `\uFEFF` — ZWJ/ZWNJ/BOM) in `lastMessage` fields cause an infinite re-render loop when rendered in the sidebar's `autoAnimate`-powered sub-menu list.

The AI chat responses sometimes contain invisible zero-width joiners (e.g., from markdown rendering or model output). When these strings are passed through `getAppSidebarConfig()` → `.slice(0, 30)` → rendered as sidebar sub-item labels, the combination of `autoAnimate` (FormKit) mutation observations and Svelte 5's fine-grained reactivity creates a synchronous loop that never yields to the event loop.

**Fix**: Strip zero-width characters server-side in the `listThreads` query and `updateThreadMetadata` mutation before they reach the client.

### Why the diagnosis was so hard

- Zero-width chars are invisible in logs and JSON output
- The freeze appeared to be caused by `$state` deep proxies (convex-svelte #44) because:
  - Removing the array query → no freeze (no data → no zero-width chars)
  - Hardcoded simple test data → no freeze (no zero-width chars in test data)
  - Writing state from callback → freeze (real data has zero-width chars)
- All workarounds (setTimeout, MessageChannel, buffer+interval, JSON roundtrip) failed because they preserved the data content

## What We Tried (Chronologically)

### 1. Denormalize the backend query

- Removed `ctx.runQuery(components.agent.*)` calls from `listThreads`
- Made it read only from `aiChatThreads` table (no component queries)
- **Result**: Still freezes — the backend query content doesn't matter

### 2. `$state.snapshot()` in `$derived`

```svelte
const aiChatThreads = $derived($state.snapshot(query.data?.threads ?? []));
```

- **Result**: Still freezes — reading `.data` triggers proxy tracking before snapshot runs

### 3. `$effect` with `untrack` writes

```svelte
$effect(() => {
    const d = query.data;
    if (d) untrack(() => { aiChatThreads = d.threads; });
});
```

- **Result**: Still freezes — the READ of `.data` in the effect is the trigger

### 4. `$effect.pre` with identity check

```svelte
let lastRef;
$effect.pre(() => {
    const ref = query.data;
    if (ref && ref !== lastRef) {
        lastRef = ref;
        untrack(() => { aiChatThreads = ref.threads; });
    }
});
```

- **Result**: Still freezes — `ref !== lastRef` is always true (new proxy each time)

### 5. `client.onUpdate()` with JSON dedup

```svelte
let lastJson = '';
client.onUpdate(query, args, (result) => {
    const json = JSON.stringify(result);
    if (json === lastJson) return;
    lastJson = json;
    aiChatThreads = result.threads;
});
```

- **Result**: Still freezes — the callback fires so fast that JSON.stringify blocks

### 6. `client.onUpdate()` with `requestAnimationFrame`

```svelte
let pending = false;
client.onUpdate(query, args, (result) => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
        aiChatThreads = result.threads;
        pending = false;
    });
});
```

- **Result**: Still freezes — the loop is synchronous, rAF never fires

### 7. `onMount` (non-reactive) + `client.onUpdate()` + `$state.raw`

- Moved subscription to `onMount` (no `$effect` dependency tracking)
- Used `$state.raw` for storage
- Used `structuredClone` on the data
- **Result**: Still freezes

### 8. `ConvexHttpClient` polling (HTTP, no WebSocket)

```svelte
onMount(() => {
    const httpClient = new ConvexHttpClient(url);
    async function poll() {
        const result = await httpClient.query(listThreads, { limit: 5 });
        aiChatThreads = result.threads;
        setTimeout(poll, 10_000);
    }
    poll();
});
```

- **Result**: WORKS but threads don't load (auth token issue) and polling is not reactive

### 9. `usePaginatedQuery` (cursor pagination)

- Rewrote backend to use Convex cursor pagination
- Used `usePaginatedQuery` from convex-svelte
- **Result**: Still freezes — `usePaginatedQuery` also stores in `$state` (deep proxy)

### 10. `client.onUpdate()` + `structuredClone()` + `$state.raw`

```svelte
client.onUpdate(query, args, (data) => {
    aiChatThreads = structuredClone(data.threads);
});
```

- **Result**: Still freezes

## Resources

### GitHub Issues

- **convex-svelte #44**: "Running into effect_update_depth_exceeded"
  https://github.com/get-convex/convex-svelte/issues/44
  — Same symptom, unresolved, reporter abandoned

### Svelte Issues

- **svelte #16224**: "Infinite loop of $effect when modifying states containing arrays then reading them"
  https://github.com/sveltejs/svelte/issues/16224
- **svelte #16516**: "Partially raw state (shallow proxy)"
  https://github.com/sveltejs/svelte/issues/16516
- **svelte #14686**: "Proxy/adapter state pattern (mutable $derived)"
  https://github.com/sveltejs/svelte/discussions/14686

### Convex Docs

- "Help, my app is overreacting!": https://stack.convex.dev/help-my-app-is-overreacting
- Svelte Quickstart: https://docs.convex.dev/quickstart/svelte

### Library Source (local references)

- convex-svelte fork: `references/convex-svelte/` (mmailaender's fork)
- `useQuery` source: `references/convex-svelte/src/lib/client.svelte.ts`
- `usePaginatedQuery` source: `references/convex-svelte/src/lib/use_paginated_query.svelte.ts`
- `ConvexClient.onUpdate`: `node_modules/convex/dist/esm/browser/simple_client.js`

### Key Code Paths

**convex-svelte `useQuery`** (`client.svelte.ts:136`):

```ts
const state = $state({          // ← Deep proxy created here
    result: ...,
});

$effect(() => {
    client.onUpdate(query, args, (data) => {
        state.result = structuredClone(data);  // ← Triggers proxy tracking
    });
});

const syncResult = $derived.by(() => {
    client.localQueryResult(query, args);  // ← Returns new ref each time
    void state.result;                     // ← Tracks state changes
    return value;
});
```

**convex-svelte `usePaginatedQuery`** (`use_paginated_query.svelte.ts:83`):

```ts
const state = $state({
	// ← Same deep proxy issue
	results: []
});

machine.subscribe(() => {
	state.results = snapshot.results; // ← Triggers proxy tracking
});
```

## Remaining Investigation

1. **Why does writing `$state.raw` from `onUpdate` freeze?** — `$state.raw` shouldn't create deep proxies. The freeze shouldn't happen if the template only reads `$state.raw`. Need to verify with a minimal reproduction.

2. **Is the Convex client synchronously re-delivering from cache?** — When we write to state and Svelte re-renders, does the render synchronously call back into Convex? If `localQueryResult()` is called during render and returns a new ref, this could trigger the cycle even without `useQuery`.

3. **Does the freeze happen on the cloud backend?** — All testing was on the local Convex backend. The local backend might have different subscription behavior.

4. **Can we patch convex-svelte?** — The fork is in `references/convex-svelte/`. Changing `$state` to `$state.raw` for `results` in both hooks might fix it at the source.

## Current Workaround

HTTP polling via `ConvexHttpClient` works but loses real-time reactivity and has auth token issues. The sidebar currently doesn't show threads.
