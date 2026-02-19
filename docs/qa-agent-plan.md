# Q&A Agent Plan

Admin panel Q&A agent that answers questions and performs actions by querying/mutating Convex data, scoped to the calling user's permissions.

## Architecture Overview

```
User asks natural language question
  |
  v
Q&A Agent (Convex @convex-dev/agent)
  - System prompt: serialized resource catalog + user permissions
  - Tools: discoverResources, queryResource, mutateResource, executeAction
  - maxSteps: 5 (multi-hop queries)
  |
  v
Generic tool handlers
  1. Resolve resource from registry
  2. Check user permissions (canSee, canCreate, canUpdate, canDelete, action.canRun)
  3. Dispatch to ResourceRuntime query/mutation refs
  4. Apply field visibility (canSee per field)
  5. Return results to agent
```

## Design Principles

- **Metadata-driven**: resource definitions are the single source of truth for both the admin UI and the agent. Define a resource once, get UI + agent access automatically.
- **Permission-scoped**: the agent can only see/do what the user's role allows. Same `canCreate`/`canUpdate`/`canDelete`/`canSee` checks as the UI.
- **No per-resource agent code**: adding a new resource or table requires zero changes to the agent. Register the resource, configure permissions, done.
- **Nova pattern**: no "resource modes" — every resource is the same shape, just with different authorization overrides (following Laravel Nova's approach).

## Pre-Work: Resource System Changes

### 1. Make `ResourceRuntime` mutations optional

Current state: `ResourceRuntime` requires all CRUD mutations, which doesn't work for read-only or action-only resources like users and support threads.

**File**: `src/lib/admin/types.ts`

```typescript
// Before
export type ResourceRuntime = {
	list: QueryRef;
	count: QueryRef;
	resolveLastPage: QueryRef;
	getById: QueryRef;
	create: MutationRef;
	update: MutationRef;
	delete: MutationRef;
	restore: MutationRef;
	forceDelete: MutationRef;
	replicate: MutationRef;
	runAction: MutationRef;
	getMetrics: QueryRef;
	listRelationOptions?: Record<string, QueryRef>;
};

// After
export type ResourceRuntime = {
	// Required — every resource must be queryable
	list: QueryRef;
	count: QueryRef;
	getById: QueryRef;

	// Optional — only if the resource supports these operations
	resolveLastPage?: QueryRef;
	create?: MutationRef;
	update?: MutationRef;
	delete?: MutationRef;
	restore?: MutationRef;
	forceDelete?: MutationRef;
	replicate?: MutationRef;
	runAction?: MutationRef;
	getMetrics?: QueryRef;
	listRelationOptions?: Record<string, QueryRef>;
};
```

### 2. Add `useGenericRoutes` flag to `ResourceDefinition`

Decouples the resource registry from the generic `[resource=resource]` CRUD UI routes. Resources with `useGenericRoutes: false` still appear in the registry (and thus the agent's catalog) but don't render via the generic route pages.

**File**: `src/lib/admin/types.ts`

```typescript
export type ResourceDefinition<TTable extends string = string> = {
	// ...existing fields...

	/** Whether this resource uses the generic [resource=resource] CRUD routes. Default: true. */
	useGenericRoutes?: boolean;
};
```

### 3. Guard `[resource=resource]` routes

The `[resource=resource]` param matcher and/or the page load must skip resources where `useGenericRoutes === false`.

**File**: `src/params/resource.ts` (or equivalent route guard)

```typescript
// Only match resources that use generic routes
export function match(param: string): boolean {
	const resource = getResourceByName(param);
	return resource != null && resource.useGenericRoutes !== false;
}
```

### 4. Register users as a resource

**File**: `src/lib/admin/resources/users.ts` (new)

```typescript
export const usersResource = defineResource({
	name: 'users',
	table: 'user', // Better Auth table
	groupKey: 'admin.resources.groups.system',
	navTitleKey: 'admin.resources.users.nav_title',
	icon: UsersIcon,
	useGenericRoutes: false, // custom UI at /admin/users
	title: (record) => String(record.name ?? record.email ?? ''),
	search: ['name', 'email'],
	sortFields: ['name', 'email', 'role', 'createdAt'],
	canCreate: () => false, // users sign up themselves
	canDelete: () => false, // deletion through auth system
	fields: [
		defineField({
			type: 'text',
			attribute: 'name',
			labelKey: '...',
			showOnIndex: true,
			showOnDetail: true
		}),
		defineField({
			type: 'email',
			attribute: 'email',
			labelKey: '...',
			showOnIndex: true,
			showOnDetail: true
		}),
		defineField({
			type: 'avatar',
			attribute: 'image',
			labelKey: '...',
			showOnIndex: true,
			showOnDetail: true
		}),
		defineField({
			type: 'select',
			attribute: 'role',
			labelKey: '...',
			showOnIndex: true,
			showOnDetail: true,
			options: [
				{ value: 'user', labelKey: '...' },
				{ value: 'admin', labelKey: '...' }
			]
		}),
		defineField({
			type: 'boolean',
			attribute: 'banned',
			labelKey: '...',
			showOnIndex: true,
			showOnDetail: true
		}),
		defineField({
			type: 'boolean',
			attribute: 'emailVerified',
			labelKey: '...',
			showOnDetail: true
		}),
		defineField({ type: 'datetime', attribute: 'createdAt', labelKey: '...', showOnDetail: true })
	],
	actions: [
		defineAction({
			key: 'ban',
			nameKey: '...',
			destructive: true,
			canRun: (user) => user.role === 'admin'
		}),
		defineAction({ key: 'unban', nameKey: '...', canRun: (user) => user.role === 'admin' }),
		defineAction({
			key: 'setRole',
			nameKey: '...',
			canRun: (user) => user.role === 'admin',
			fields: [
				defineField({
					type: 'select',
					attribute: 'role',
					labelKey: '...',
					showOnForm: true,
					options: [
						{ value: 'user', labelKey: '...' },
						{ value: 'admin', labelKey: '...' }
					]
				})
			]
		})
	]
});

export const usersRuntime: ResourceRuntime = {
	list: api.admin.queries.listUsers,
	count: api.admin.queries.getUserCount,
	getById: api.admin.queries.getUserById,
	runAction: api.admin.mutations.runUserAction // new: dispatches ban/unban/setRole
};
```

### 5. Register support threads as a resource

**File**: `src/lib/admin/resources/support-threads.ts` (new)

```typescript
export const supportThreadsResource = defineResource({
	name: 'support-threads',
	table: 'supportThreads',
	groupKey: 'admin.resources.groups.system',
	navTitleKey: 'admin.resources.support.nav_title',
	icon: MessageCircleIcon,
	useGenericRoutes: false, // custom UI at /admin/support
	title: (record) => String(record.title ?? record.searchText ?? 'Thread'),
	search: ['searchText'],
	sortFields: ['status', 'priority', 'createdAt', 'updatedAt'],
	canCreate: () => false, // threads created by users
	canDelete: () => false,
	canUpdate: (user) => user.role === 'admin',
	fields: [
		defineField({
			type: 'select',
			attribute: 'status',
			labelKey: '...',
			showOnIndex: true,
			showOnDetail: true,
			options: [
				{ value: 'open', labelKey: '...' },
				{ value: 'awaiting_response', labelKey: '...' },
				{ value: 'closed', labelKey: '...' }
			]
		}),
		defineField({
			type: 'select',
			attribute: 'priority',
			labelKey: '...',
			showOnIndex: true,
			showOnDetail: true
		}),
		defineField({
			type: 'text',
			attribute: 'assignedTo',
			labelKey: '...',
			showOnIndex: true,
			showOnDetail: true
		}),
		defineField({ type: 'boolean', attribute: 'isHandedOff', labelKey: '...', showOnDetail: true }),
		defineField({ type: 'text', attribute: 'userName', labelKey: '...', showOnIndex: true }),
		defineField({ type: 'email', attribute: 'userEmail', labelKey: '...', showOnIndex: true }),
		defineField({ type: 'text', attribute: 'lastMessage', labelKey: '...', showOnDetail: true }),
		defineField({ type: 'datetime', attribute: 'createdAt', labelKey: '...', showOnDetail: true })
	],
	actions: [
		defineAction({
			key: 'assign',
			nameKey: '...',
			canRun: (user) => user.role === 'admin',
			fields: [
				defineField({ type: 'select', attribute: 'adminUserId', labelKey: '...', showOnForm: true })
			]
		}),
		defineAction({ key: 'close', nameKey: '...', canRun: (user) => user.role === 'admin' }),
		defineAction({
			key: 'setPriority',
			nameKey: '...',
			canRun: (user) => user.role === 'admin',
			fields: [
				defineField({
					type: 'select',
					attribute: 'priority',
					labelKey: '...',
					showOnForm: true,
					options: [
						{ value: 'low', labelKey: '...' },
						{ value: 'medium', labelKey: '...' },
						{ value: 'high', labelKey: '...' }
					]
				})
			]
		})
	]
});

export const supportThreadsRuntime: ResourceRuntime = {
	list: api.support.admin.queries.listThreads, // may need new generic-compatible wrapper
	count: api.support.admin.queries.getThreadCount, // may need new query
	getById: api.support.admin.queries.getThread, // may need new query
	runAction: api.support.admin.mutations.runThreadAction // new: dispatches assign/close/setPriority
};
```

### 6. Optional: Register admin settings

Only if agent should be able to read/modify app-level settings.

### 7. Backend: Add `runUserAction` / `runThreadAction` dispatchers

These are generic action dispatch mutations that receive an action key + args and route to the correct existing mutation. Pattern:

```typescript
// src/lib/convex/admin/mutations.ts
export const runUserAction = adminMutation({
	args: { actionKey: v.string(), ids: v.array(v.string()), fields: v.optional(v.any()) },
	handler: async (ctx, args) => {
		switch (args.actionKey) {
			case 'ban':
				for (const id of args.ids) await banUser(ctx, id, args.fields?.reason);
				break;
			case 'unban':
				for (const id of args.ids) await unbanUser(ctx, id);
				break;
			case 'setRole':
				for (const id of args.ids) await setUserRole(ctx, id, args.fields?.role);
				break;
			default:
				throw new Error(`Unknown action: ${args.actionKey}`);
		}
	}
});
```

## Agent Implementation

### Agent Definition

**File**: `src/lib/convex/qa/agent.ts` (new)

```typescript
import { Agent } from '@convex-dev/agent';

export const qaAgent = new Agent(components.agent, {
	name: 'Admin Q&A',
	languageModel: openrouter('...'), // model TBD
	instructions: `You are an admin Q&A assistant for SaaS Starter.
You can query and modify data based on the user's permissions.
Always use the discoverResources tool first to understand what data is available.
For write operations, always describe what you're about to do and ask for confirmation before executing.
Be concise. Format data in readable tables when appropriate.`,
	contextOptions: { recentMessages: 20 },
	maxSteps: 5
});
```

### Tool 1: `discoverResources`

No args. Returns the resource catalog filtered by user permissions.

```typescript
const discoverResourcesTool = createTool({
	description: 'Discover what data resources are available and what operations you can perform.',
	args: z.object({}),
	handler: async (ctx) => {
		// 1. Get user from context (ctx.userId)
		// 2. Load all resource definitions from registry
		// 3. Filter by canSee(user)
		// 4. For each resource, compute allowed operations based on canCreate/canUpdate/canDelete + user role
		// 5. Serialize fields (name, type, filterable, searchable, sortable) + actions + filters
		// 6. Return catalog
		return resources.map((r) => ({
			name: r.name,
			table: r.table,
			fields: r.fields
				.filter((f) => !f.canSee || f.canSee(user))
				.map((f) => ({
					attribute: f.attribute,
					type: f.type,
					filterable: !!f.filterable,
					searchable: !!f.searchable,
					sortable: !!f.sortable
				})),
			operations: {
				read: true,
				create: r.canCreate?.(user) ?? true,
				update: r.canUpdate?.(user, {}) ?? true,
				delete: r.canDelete?.(user, {}) ?? true
			},
			actions: r.actions
				?.filter((a) => !a.canRun || a.canRun(user))
				.map((a) => ({
					key: a.key,
					fields: a.fields?.map((f) => ({
						attribute: f.attribute,
						type: f.type,
						options: f.options
					})),
					destructive: a.destructive
				})),
			filters: r.filters?.map((f) => ({ key: f.key, type: f.type, options: f.options })),
			searchFields: r.search,
			sortFields: r.sortFields
		}));
	}
});
```

### Tool 2: `queryResource`

Generic read across any resource.

```typescript
const queryResourceTool = createTool({
	description:
		'Query data from a resource. Use discoverResources first to know available resources and fields.',
	args: z.object({
		resource: z.string(),
		filters: z
			.array(
				z.object({
					field: z.string(),
					op: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains']),
					value: z.any()
				})
			)
			.optional(),
		search: z.string().optional(),
		sort: z.object({ field: z.string(), order: z.enum(['asc', 'desc']) }).optional(),
		limit: z.number().default(20)
	}),
	handler: async (ctx, args) => {
		// 1. Resolve resource definition + runtime from registry
		// 2. Validate user has read permission
		// 3. ctx.runQuery(runtime.list, { translated args })
		// 4. Apply field visibility (canSee per field per record)
		// 5. Return { items, total }
	}
});
```

### Tool 3: `mutateResource`

Generic create/update/delete.

```typescript
const mutateResourceTool = createTool({
	description:
		'Create, update, or delete a resource record. Confirm with the user before executing.',
	args: z.object({
		resource: z.string(),
		operation: z.enum(['create', 'update', 'delete', 'restore']),
		id: z.string().optional(), // required for update/delete/restore
		data: z.record(z.any()).optional() // required for create/update
	}),
	handler: async (ctx, args) => {
		// 1. Resolve resource definition + runtime
		// 2. Check canCreate/canUpdate/canDelete for this user
		// 3. Validate runtime has the required mutation (e.g. runtime.create exists)
		// 4. ctx.runMutation(runtime[operation], { id, data })
		// 5. Return result
	}
});
```

### Tool 4: `executeAction`

Run named actions (ban, assign, setRole, etc.).

```typescript
const executeActionTool = createTool({
	description: 'Execute a named action on one or more resource records. Confirm with user first.',
	args: z.object({
		resource: z.string(),
		actionKey: z.string(),
		ids: z.array(z.string()),
		fields: z.record(z.any()).optional() // action-specific fields
	}),
	handler: async (ctx, args) => {
		// 1. Resolve resource definition + runtime
		// 2. Find action in resource.actions by key
		// 3. Check action.canRun(user)
		// 4. Validate runtime.runAction exists
		// 5. ctx.runMutation(runtime.runAction, { actionKey, ids, fields })
		// 6. Return result
	}
});
```

## Example Interactions

### Read query

```
Admin: "How many open support tickets are unassigned?"
Agent: calls discoverResources → sees support-threads with status/assignedTo fields
Agent: calls queryResource("support-threads", filters: [status=open, assignedTo=null], limit: 0)
       + count from response
Agent: "There are 7 open unassigned support tickets."
```

### Multi-hop query

```
Admin: "Who owns the most active projects?"
Agent: calls queryResource("demo-projects", filters: [status=active])
Agent: groups by ownerEmail, counts
Agent: "alice@example.com has 12 active projects, followed by bob@example.com with 8."
```

### Write action with confirmation

```
Admin: "Ban the user who's been spamming support"
Agent: calls queryResource("support-threads", sort: count desc, limit: 1) → finds top offender
Agent: calls queryResource("users", filters: [email=spammer@example.com])
Agent: "I found user 'spammer@example.com' with 15 flagged threads. Should I ban them?"
Admin: "Yes"
Agent: calls executeAction("users", "ban", ids: ["user_id"], fields: { reason: "spam" })
Agent: "Done. User banned."
```

### Permission denied

```
Regular user: "Delete all projects"
Agent: calls discoverResources → sees demo-projects with operations.delete = false
Agent: "I can look up projects for you, but I don't have permission to delete them."
```

## File Structure

```
src/lib/convex/qa/
  agent.ts              # Agent definition + tool registration
  tools.ts              # Tool definitions (discoverResources, queryResource, mutateResource, executeAction)
  messages.ts           # Send/receive message mutations + AI response scheduling
  threads.ts            # Thread management (create, list, etc.)
  catalog.ts            # Resource catalog serializer (registry → agent-friendly format)

src/lib/admin/resources/
  users.ts              # NEW: users resource definition (useGenericRoutes: false)
  support-threads.ts    # NEW: support threads resource definition (useGenericRoutes: false)
  demo-projects.ts      # existing
  demo-tasks.ts         # existing
  demo-tags.ts          # existing
  demo-comments.ts      # existing

src/routes/[[lang]]/admin/qa/
  +page.svelte          # Q&A chat UI (similar to support chat but for admin queries)
```

## Implementation Order

1. **Resource system changes** (pre-work, no agent code)
   - Make `ResourceRuntime` mutations optional
   - Add `useGenericRoutes` flag to `ResourceDefinition`
   - Guard `[resource=resource]` route param matcher
   - Verify existing demo resources still work

2. **Register custom-UI resources**
   - `users.ts` resource definition + runtime
   - `support-threads.ts` resource definition + runtime
   - Backend: `runUserAction` / `runThreadAction` dispatcher mutations
   - Backend: any missing list/count/getById queries for users/threads in generic format

3. **Agent backend**
   - `catalog.ts` — serialize resource registry for agent consumption
   - `tools.ts` — implement the 4 generic tools
   - `agent.ts` — agent definition with tools
   - `threads.ts` + `messages.ts` — conversation management (mirror support chat pattern)

4. **Agent frontend**
   - Q&A chat page in admin panel
   - Reuse existing chat components from support system where possible

## Open Questions

- **Model selection**: which LLM for the Q&A agent? Needs good tool-calling support. Consider claude-sonnet or gpt-4o-mini for cost/speed balance.
- **Confirmation UX**: should write-action confirmation be LLM-driven (system prompt instruction) or enforced at the tool level (two-phase preview/execute)?
- **Rate limiting**: separate rate limits for Q&A agent vs support agent?
- **Conversation persistence**: should Q&A conversations be saved? Useful for audit trail but adds storage.
- **Non-resource data**: any data the agent should access that doesn't fit the resource model at all? (e.g., aggregate dashboard metrics, audit logs)
- **Multi-tenant**: if org-scoping is enabled, should the agent auto-filter by the user's active organization?

## Future: Code Generation Fallback (Option C/D from initial research)

If the structured query tool proves too limiting for complex analytical questions ("what's the average budget of active projects grouped by owner?"), a code-generation fallback can be added later:

- Agent writes a JS query string
- Convex action calls the system REPL API (`runOneoffQuery` equivalent) with admin credentials
- Results are post-filtered through field visibility before returning
- Requires: whitelisted table names, execution timeout, sandboxed template wrapping permission checks

This is a separate initiative and not required for the initial implementation.
