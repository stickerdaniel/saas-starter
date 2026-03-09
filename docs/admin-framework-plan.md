# Admin Framework Plan

Building a declarative, resource-driven admin panel inspired by Laravel Nova — implemented in Svelte 5 + TypeScript + Convex.

---

## Architecture Overview

A **declarative resource configuration** drives the entire admin UI: tables, detail pages, forms, filters, sidebar navigation, search, and authorization.

### Documentation Model

- `docs/nova-vs-admin-framework-comparison.md` is the canonical parity and intentional-drift ledger.
- `docs/admin-framework-plan.md` is the canonical architecture and implementation-model document.
- Do not maintain a separate long-lived Nova mapping doc. If a change affects feature parity, update the comparison doc. If it affects durable architecture, update this file.
- When Nova and Convex-native UX differ, document the divergence explicitly instead of implying 1:1 parity.

### Data Flow

1. Resource definition objects declare fields, actions, filters, metrics
2. Each resource has a dedicated Convex file with explicit exports; handlers call shared utility functions for pagination/filter/sort
3. Generic Svelte page components render the appropriate UI based on resource config
4. User interactions (CRUD, actions, filters, search) call Convex mutations
5. Authorization is checked at every level (server hooks, Convex function builders, resource/field `canSee`, action `canRun`)
6. Convex subscriptions provide real-time updates — resubscribing automatically when `useQuery` args change

### Key Architectural Decisions

- **Hybrid backend**: Shared utility functions + per-resource Convex files (Convex requires explicit function exports per endpoint — no single dynamic function for all tables)
- **Component map for field rendering**: `Record<string, Record<string, Component>>` keyed by `{fieldType}.{context}` — Svelte 5 renders components dynamically by default (no `<svelte:component>` needed)
- **Custom `$state` forms**: Not Superforms — Superforms is designed for SvelteKit form actions and doesn't fit Convex-backed dynamic CRUD
- **URL state via Runed `useSearchParams`**: Already proven in `createConvexCursorTable`
- **Server-side field authorization**: `canSee` runs in Convex queries — unauthorized data never leaves the server
- **Auto-discovery resource registry**: `import.meta.glob` in `registry.ts` discovers resource modules automatically from `resources/*.ts` files — no manual registration needed
- **Granular permissions**: Better Auth's `createAccessControl` with custom statements and roles
- **Custom admin tools coexist with generated resources**: bespoke pages like support remain valid; the generated `[resource=resource]` path is the canonical Nova-parity surface
- **Durable background work should use Convex components**: prefer `@convex-dev/workpool` for queued batch actions over ad-hoc scheduler tables once the prototype is replaced

### Forward-Looking Decisions

- **Queued actions**: Keep `runtime.runAction` for small synchronous actions. For long-running or high-cardinality batch work, move to `@convex-dev/workpool` with per-resource queues, retry/backoff, concurrency limits, and progress documents that the UI can subscribe to.
- **Peek / preview**: Treat preview and peek as live read models, not one-shot snapshots. The default should be a subscription-backed query with server-side field visibility. Add an optional lightweight `peek` query per resource later if `getById` becomes too heavy.
- **Audit logging**: Standardize on one append-only admin audit event stream for future work. Resource CRUD, relation changes, admin-tool events, and queued action lifecycle should all land in the same canonical table shape, with projections/queries layered on top for resource detail timelines, global audit views, and notification fan-out.

### Nova Mapping At The Architecture Layer

These are stable framework-level mappings and should live here instead of in a separate mapping file.

- **Core parity**
  - `Nova Resource` -> `ResourceDefinition` in `src/lib/admin/resources/*.ts`
  - `fields()` -> `fields: FieldDefinition[]`
  - `filters()` -> `filters: FilterDefinition[]` with URL state sync
  - `actions()` -> `actions: ActionDefinition[]` + resource action mutations
  - `lenses()` -> `lenses: LensDefinition[]` via URL state + backend interpretation
  - `cards()/metrics()` -> `metrics: MetricDefinition[]` + resource metric queries
  - `softDeletes()` -> `deletedAt` + `trashed` filter + restore/force-delete mutations
  - `replicate()` -> `replicate<Resource>` mutations
- **Relationship mapping**
  - `belongsTo` -> document ID + relation option query
  - `hasMany` -> derived related-resource payloads on detail views
  - `manyToMany` -> pivot table + attach/detach mutations
  - `morphTo` -> discriminated union with per-kind indexes and resolvers
- **Intentional runtime drift**
  - Nova polling -> intentionally omitted; Convex subscriptions are the live-update model
  - Resource index state -> `createConvexCursorTable` + `ConvexCursorTableShell`
  - Server field visibility -> `_visibleFields` in list/detail payloads
  - Admin navigation/search -> resource registry entries appended around existing custom admin pages
- **Authorization mapping**
  - Nova policies/gates -> admin-role enforcement via Convex wrappers plus optional statement-level checks
  - Enforcement points: resource queries/mutations, action execution, relationship attach/detach, and metric reads

---

## Core Concepts

### 1. Resource Definitions

A resource wraps a Convex table and declares everything the admin UI needs. The `defineResource` builder validates `attribute` keys against the Convex table schema at compile time via `DocFields<TTable>`.

```typescript
import type { Doc, TableNames } from '$lib/convex/_generated/dataModel';

type DocFields<T extends TableNames> = keyof Omit<Doc<T>, '_id' | '_creationTime'>;

type ResourceDefinition<TTable extends TableNames> = {
	name: string;
	table: TTable;
	title: (record: Doc<TTable>) => string;
	subtitle?: (record: Doc<TTable>) => string;
	search?: (DocFields<TTable> & string)[];
	group: string;
	icon: string;
	perPage?: number;
	softDeletes?: boolean;
	tenantScoped?: boolean; // Filter by organizationId when set
	canSee?: (user: BetterAuthUser) => boolean;
	fields: FieldDefinition<TTable>[];
	actions?: ActionDefinition[];
	filters?: FilterDefinition[];
	metrics?: MetricDefinition[];
};

function defineResource<TTable extends TableNames>(
	config: ResourceDefinition<TTable>
): ResourceDefinition<TTable> {
	return config;
}
```

For Better Auth component-managed tables (where `Doc<T>` doesn't apply), use explicit type interfaces with `satisfies`:

```typescript
type UserFields = keyof BetterAuthUser;
// Use `attribute: 'email' satisfies UserFields` for compile-time validation
```

### 2. Field System

Fields resolve differently depending on context: **index** (table cell), **detail** (read-only), **form** (input).

```typescript
type FieldDefinition<TTable extends TableNames> = {
	type: FieldType;
	attribute: DocFields<TTable> & string;
	label: string;
	sortable?: boolean;
	searchable?: boolean;
	filterable?: boolean;
	rules?: GenericSchema; // Valibot schema
	showOnIndex?: boolean;
	showOnDetail?: boolean;
	showOnForm?: boolean;
	resolveUsing?: (record: any) => any;
	displayUsing?: (value: any) => string;
	fillUsing?: (value: any) => any;
	dependsOn?: FieldDependency;
	canSee?: (user: BetterAuthUser, record?: any) => boolean;
	securityLevel?: 'server' | 'client'; // Default: 'server'
	immutable?: boolean;
	inlineEditable?: boolean; // Allow editing directly in table cell
	inlineConfirmation?: boolean; // Require confirmation dialog for inline edits
	placeholder?: string;
	helpText?: string;
	group?: string; // Tab group key for detail/form pages
};
```

#### Field Types

| Type        | Index Component    | Detail Component   | Form Component             |
| ----------- | ------------------ | ------------------ | -------------------------- |
| `text`      | plain text         | plain text         | `Input`                    |
| `textarea`  | truncated text     | full text          | `Textarea`                 |
| `number`    | formatted number   | formatted number   | `Input[type=number]`       |
| `boolean`   | badge/icon         | badge/icon         | `Switch`                   |
| `select`    | badge              | badge              | `Select`                   |
| `date`      | formatted date     | formatted date     | `DatePicker`               |
| `datetime`  | formatted datetime | formatted datetime | `DateTimePicker`           |
| `email`     | mailto link        | mailto link        | `Input[type=email]`        |
| `url`       | external link      | external link      | `Input[type=url]`          |
| `image`     | thumbnail          | full image         | `FileUpload`               |
| `json`      | collapsed preview  | formatted JSON     | `CodeEditor` (lazy-loaded) |
| `badge`     | colored badge      | colored badge      | read-only                  |
| `belongsTo` | link to related    | link to related    | searchable `Select`        |
| `hasMany`   | count badge        | related table      | —                          |

#### Field Component Registry

Use a static component map. SvelteKit code-splits per route, so eager imports are fine for core types. Lazy-load only heavy components (code editor, rich text).

```typescript
// src/lib/admin/fields/registry.ts
import type { Component } from 'svelte';

type FieldContext = 'index' | 'detail' | 'form';

export const fieldComponentMap: Record<string, Record<FieldContext, Component<any>>> = {
	text: { index: IndexText, detail: DetailText, form: FormText },
	select: { index: IndexSelect, detail: DetailSelect, form: FormSelect },
	boolean: { index: IndexBoolean, detail: DetailBoolean, form: FormBoolean }
	// ...
};

// Heavy components loaded on demand
export const lazyFieldComponents: Record<string, () => Promise<{ default: Component }>> = {
	json: () => import('./json/FormJson.svelte')
};
```

#### Dependent Fields

Use `dependsOn` config + `$derived` visibility. Because `form.values` is `$state`, the `isFieldVisible()` pure function re-evaluates automatically. No `$effect` needed.

```typescript
interface FieldDependency {
	field: string;
	value?: any; // Show when field equals this value
	predicate?: (value: any) => boolean; // Or custom predicate
	optionsFrom?: (parentValue: any) => Option[]; // Dynamic options based on parent
}

function isFieldVisible(field: FieldDefinition, values: Record<string, any>): boolean {
	if (!field.dependsOn) return true;
	const parentValue = values[field.dependsOn.field];
	if (field.dependsOn.predicate) return field.dependsOn.predicate(parentValue);
	return parentValue === field.dependsOn.value;
}
```

#### Inline Editing

Support selectively — not universally:

- **Toggles/selects**: Inline with `SvelteMap` overlay for optimistic state (existing notification preferences pattern)
- **High-risk changes** (role, ban): Confirmation dialog before applying
- **Text fields**: Not inline — route to detail/edit page (poor UX for inline text: focus conflicts, validation, accidental edits)

#### Field-Level Authorization

Server-side by default (mirrors Nova). `canSee` runs during Convex query serialization — unauthorized field data is never returned. The query returns a `_visibleFields` array so the UI knows which components to render.

Allow explicit `securityLevel: 'client'` opt-in for fields that are purely layout/UX concerns.

### 3. Action System

Actions are operations performed on one or more selected resources. They map to Convex mutations/actions.

```typescript
interface ActionDefinition {
	name: string;
	icon: string;
	destructive?: boolean;
	confirmText?: string;
	confirmButtonText?: string;
	cancelButtonText?: string;
	standalone?: boolean; // No selected records required
	showOnIndex?: boolean;
	showOnDetail?: boolean;
	showInline?: boolean; // Appears directly in table row
	withoutConfirmation?: boolean; // Execute immediately, no modal
	fields?: FieldDefinition<any>[];
	handler: string; // Convex function reference
	canRun?: (user: BetterAuthUser, record: any) => boolean;
}
```

**Execution flow:**

1. User selects records + clicks action
2. If action has `fields`, show confirmation modal with dynamic form
3. On confirm, call Convex mutation with selected record IDs + form data
4. Show success/error toast (via `svelte-sonner`)
5. Table auto-refreshes via Convex subscription

**Action response types** (returned from Convex):

- `{ type: 'message', text }` — success toast
- `{ type: 'danger', text }` — error toast
- `{ type: 'download', url, filename }` — trigger file download
- `{ type: 'redirect', url }` — navigate to URL

### 4. Filter System

Filters narrow the index query. State stored in URL search params via Runed `useSearchParams` + Valibot schema (proven pattern from `createConvexCursorTable`).

```typescript
interface FilterDefinition {
	type: 'select' | 'boolean' | 'date-range' | 'search';
	attribute: string;
	label: string;
	options?: { label: string; value: string | undefined }[];
	urlKey?: string; // Custom URL param name (defaults to attribute)
}
```

Canonical URL keys: `search`, `sort`, `page`, `page_size`, `cursor`, plus feature filter keys (e.g., `role`, `status`). Default values omitted from URLs.

Sort serialization: `field.dir` (e.g., `email.asc`, `created_at.desc`). Parser accepts legacy `field:dir` for backwards compatibility.

### 5. Metrics / Cards

Dashboard cards displayed above the index table or on a dedicated dashboard page. Use `@convex-dev/aggregate` for O(log n) counts/sums instead of scanning entire tables.

```typescript
interface MetricDefinition {
	type: 'value' | 'trend' | 'partition' | 'progress' | 'table';
	label: string;
	query: string; // Convex function reference
	icon?: string;
	width?: '1/4' | '1/3' | '1/2' | '2/3' | 'full';
	prefix?: string;
	suffix?: string;
	ranges?: string[]; // e.g., ['7d', '30d', '90d', 'MTD', 'YTD']
	colors?: Record<string, string>;
}
```

**Metric types:**

- `value` — single number with optional previous-period comparison
- `trend` — time-series line/area chart (LayerChart/D3)
- `partition` — pie/donut chart (categorized breakdown)
- `progress` — progress bar with target
- `table` — mini table of key-value data

**Performance**: For expensive metrics, use `@convex-dev/aggregate` (maintains materialized aggregates via Triggers, automatic sync) or scheduled functions for daily/weekly rollups.

### 6. Menu / Navigation

Sidebar auto-generated from the central resource registry, grouped by `group` property. Coexists with custom menu items for non-resource pages.

```typescript
// Auto-generated from registry:
// People
//   └─ Users
//   └─ Teams
// Content
//   └─ Posts
//   └─ Pages
// -- custom items below --
// Support (custom page, not resource-driven)
// Settings (custom page)
```

**Features:**

- Badge counts on menu items (e.g., open support tickets)
- Active state detection from current route
- Collapsible groups
- Custom menu items alongside resource items
- Resource `canSee` checks filter sidebar visibility per user permissions

### 7. Search

**Global search**: Existing command palette. Each resource declares `search` fields. Results aggregate across resources with type/icon differentiation.

**Resource search**: Debounced text input on index page (300ms default). Uses Runed `Debounced` wrapper. Multi-field search via client-side OR logic across indexed queries or Convex `withSearchIndex`.

**Relation search**: Typeahead when selecting a `belongsTo` field — queries the related resource's search fields.

**Search indexes**: Must be declared per table in the Convex schema at deploy time. The framework documents required indexes per resource. A helper can generate schema index definitions from resource configs (used at schema definition time, not runtime).

### 8. Authorization

Layered authorization:

| Layer            | Mechanism                                                | Status         |
| ---------------- | -------------------------------------------------------- | -------------- |
| Route-level      | Server hooks check JWT for admin role                    | Done           |
| Function-level   | `adminQuery` / `adminMutation` builders                  | Done           |
| Permission-level | Better Auth `createAccessControl` with custom statements | To Build       |
| Resource-level   | `canSee` on resource definition                          | To Build       |
| Action-level     | `canRun` per action                                      | Partially Done |
| Field-level      | `canSee` per field (server-side default)                 | To Build       |

#### Granular Permissions

Use Better Auth's `createAccessControl`:

```typescript
// src/lib/auth/permissions.ts
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access';

const statement = {
	...defaultStatements,
	settings: ['view', 'update'],
	support: ['view', 'respond', 'assign', 'close'],
	audit: ['view']
} as const;

export const ac = createAccessControl(statement);

export const roles = {
	user: ac.newRole({}),
	supportAgent: ac.newRole({ support: ['view', 'respond'], user: ['list'] }),
	admin: ac.newRole({
		...adminAc.statements,
		settings: ['view', 'update'],
		support: ['view', 'respond', 'assign', 'close'],
		audit: ['view']
	})
};
```

Extend `adminQuery`/`adminMutation` with a `permissionQuery` builder that checks granular permissions via `ac.checkRolePermission()`. Users can hold multiple comma-separated roles.

#### Multi-Tenancy (Future)

Use Better Auth's organization plugin when needed:

- Add `tenantScoped: true` to resource definitions
- Generic CRUD layer filters by `organizationId` via index transparently
- Three scoping levels: **global** (users, settings), **tenant-scoped** (projects, docs), **hybrid** (support tickets visible cross-org to system admins)

---

## Component Architecture

### Generic Page Components

| Component                  | Purpose                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `ResourceIndex.svelte`     | Table view with filters, search, bulk actions, pagination — wraps `ConvexCursorTableShell` |
| `ResourceDetail.svelte`    | Read-only detail view with tabbed field panels, related resources                          |
| `ResourceCreate.svelte`    | Dynamic form for creating a new record                                                     |
| `ResourceEdit.svelte`      | Dynamic form for editing an existing record                                                |
| `ResourceDashboard.svelte` | Metrics/cards overview                                                                     |
| `ActionModal.svelte`       | Confirmation dialog with dynamic action fields                                             |
| `FilterPanel.svelte`       | Filter controls rendered from `FilterDefinition[]`                                         |
| `FieldRenderer.svelte`     | Resolves field type + context → component from registry                                    |

### Field Component Directory

```
src/lib/admin/fields/
├── registry.ts           # Component map + lazy loaders
├── visibility.ts         # isFieldVisible(), getFieldOptions()
├── text/
│   ├── index-text.svelte
│   ├── detail-text.svelte
│   └── form-text.svelte
├── select/
│   ├── index-select.svelte
│   ├── detail-select.svelte
│   └── form-select.svelte
├── boolean/
│   ├── index-boolean.svelte
│   ├── detail-boolean.svelte
│   └── form-boolean.svelte
└── ...
```

### Tab Panels for Field Grouping

Use existing shadcn-svelte Tabs with declarative `FieldGroup[]` config:

```typescript
interface FieldGroup {
	key: string;
	labelKey: string; // i18n key
	fields: FieldDefinition<any>[];
}
```

Renderer auto-selects tabs vs flat layout based on group count. Single group = no tabs.

### Dynamic Form State

Custom `$state`-based form handling (not Superforms):

```typescript
// src/lib/admin/form-state.svelte.ts
export function createDynamicForm(fields: FieldDefinition<any>[]) {
	let values = $state<Record<string, any>>({});
	let errors = $state<Record<string, string[]>>({});
	let isDirty = $state(false);
	let isSubmitting = $state(false);

	// Build Valibot schema dynamically from field configs
	const schema = buildSchemaFromFields(fields);

	function initialize(data?: Record<string, any>) {
		/* set defaults */
	}
	function validate(): boolean {
		/* safeParse with schema */
	}
	function setValue(name: string, value: any) {
		/* update + clear error */
	}

	return {
		get values() {
			return values;
		},
		get errors() {
			return errors;
		},
		get isDirty() {
			return isDirty;
		},
		get isSubmitting() {
			return isSubmitting;
		},
		set isSubmitting(v: boolean) {
			isSubmitting = v;
		},
		initialize,
		validate,
		setValue
	};
}
```

### Routing

```
src/routes/[[lang]]/admin/
├── +layout.svelte                    # Admin layout with auto-generated sidebar
├── dashboard/+page.svelte            # Global dashboard with metrics
├── [resource=resource]/              # Generic resource pages (param matcher)
│   ├── +page.svelte                  # ResourceIndex
│   ├── [id]/
│   │   ├── +page.svelte             # ResourceDetail
│   │   └── edit/+page.svelte        # ResourceEdit
│   └── create/+page.svelte          # ResourceCreate
├── users/+page.svelte               # Custom override (takes priority)
├── support/+page.svelte             # Custom override
├── settings/+page.svelte            # Custom (not a resource)
```

**Param matcher** prevents `[resource]` from matching non-resource paths:

```typescript
// src/params/resource.ts
import { isResourceName } from '$lib/admin/registry';
export function match(param: string): boolean {
	return isResourceName(param);
}
```

Named routes (`users/`, `support/`) always take priority over `[resource=resource]/`. Custom pages import generic components and wrap them with snippet slots for partial overrides.

### Optimistic Updates

Two patterns depending on context:

- **Inline edits** (toggles, selects): `SvelteMap` overlay for pending state — simpler, avoids query arg matching
- **List mutations** (create, delete): Full Convex `optimisticUpdate` via `store.getQuery()`/`store.setQuery()`

Always use `$state.snapshot()` or `JSON.parse(JSON.stringify())` to break Svelte 5 proxy wrappers before passing data to Convex optimistic update callbacks.

---

## Convex Backend

### Per-Resource Files with Shared Utilities

Convex requires explicit function exports. Each resource gets a dedicated file; handlers call shared utilities:

```
src/lib/convex/admin/
├── utils/
│   ├── resource-query.ts    # applyResourceQuery() — shared pagination/filter/sort
│   ├── resource-mutation.ts # applyResourceMutation() — shared create/update/delete
│   └── errors.ts            # createValidationError(), isValidationError()
├── resources/
│   ├── posts.ts             # list, get, create, update, delete for posts table
│   └── orders.ts            # list, get, create, update, delete for orders table
├── search.ts                # Global search across resources
├── metrics.ts               # Metric query functions
└── actions.ts               # Action execution handlers
```

```typescript
// src/lib/convex/admin/utils/resource-query.ts
export async function applyResourceQuery<TTable extends TableNames>(
	ctx: QueryCtx,
	resource: ResourceDefinition<TTable>,
	args: {
		cursor?: string;
		numItems: number;
		search?: string;
		filters?: Record<string, string>;
		sortBy?: SortBy;
	}
) {
	let query = ctx.db.query(resource.table);
	// Apply index-based filters, search, sorting, pagination
	// Filter fields by canSee (server-side authorization)
	const results = await query.paginate({ cursor: args.cursor, numItems: args.numItems });
	return { items: results.page, continueCursor: results.continueCursor, isDone: results.isDone };
}
```

### Relationships

Use `convex-helpers` relationship utilities:

- **`belongsTo`** → `getOneFrom(ctx.db, "users", "by_id", doc.userId)`
- **`hasMany`** → `getManyFrom(ctx.db, "orders", "by_userId", user._id)`
- **`manyToMany`** → `getManyVia(ctx.db, "userRoles", "by_userId", user._id, "roleId")`

Denormalize frequently-read data for index page performance; use multi-query joins for detail pages.

### File/Image Fields

Use the upload URL method:

1. Client calls `ctx.storage.generateUploadUrl()`
2. Client uploads file directly to Convex
3. Store returned `storageId` as a field value
4. Resolve display URL via `ctx.storage.getUrl(storageId)`

### Validation Errors

Structured `ConvexError` with consistent shape:

```typescript
throw new ConvexError({
	code: 'VALIDATION_ERROR' as const,
	fieldErrors: [{ field: 'slug', message: 'Already taken' }]
});
```

Client-side: `isValidationError()` type guard + `extractFieldErrors()` helper. For remote forms, map through `invalid(issue.field())` API.

### Search Indexes

Must be declared per table in the schema at deploy time. The framework documents required indexes per resource. A helper can generate schema index definitions from resource configs (used at schema definition time).

### Performance at Scale

- **Large datasets**: Cursor pagination with indexes. `resolveLastPage` pattern for jump-to-last without walking cursors.
- **Field projection**: Convex cannot project fields — all document fields are returned. Keep documents lean; use `storageId` references for blobs.
- **Metric aggregation**: `@convex-dev/aggregate` for O(log n) counts/sums with automatic sync via Triggers. Scheduled functions for daily/weekly trend rollups.
- **Bundle size**: SvelteKit auto-splits per route. Static imports for core field components. Dynamic `import()` only for heavy editors (code, rich text, map).

---

## Resource Registration

Auto-discovery registry using `import.meta.glob`:

```typescript
// src/lib/admin/registry.ts
const modules = import.meta.glob('./resources/*.ts', { eager: true });
// Extracts default.resource + default.runtime from each module
// Builds RESOURCE_REGISTRY array + RUNTIME_MAP
```

Each resource file exports a default `ResourceModule` with co-located runtime:

```typescript
// src/lib/admin/resources/my-resource.ts
export default defineResourceModule({ resource: myResource, runtime: myRuntime });
```

No manual registration step — adding a file to `resources/` is sufficient.

---

## What We Already Have vs. What to Build

| Capability                             | Status  | Notes                                                                  |
| -------------------------------------- | ------- | ---------------------------------------------------------------------- |
| `defineResource` / registry / runtimes | Done    | Auto-discovery via `import.meta.glob`, co-located resource runtimes    |
| Generic resource pages                 | Done    | Index, detail, create, edit, preview on `[resource=resource]` routes   |
| Field component registry               | Done    | Context-aware rendering for index/detail/form/preview                  |
| Dynamic form state                     | Done    | `$state`-based form model with Valibot validation + error mapping      |
| Filters, lenses, metrics               | Done    | URL-driven filters, lens overrides, live metrics, detail-only metrics  |
| Relation fields                        | Done    | `belongsTo`, `hasMany`, `manyToMany`, `morphTo`, inline create/tagging |
| Field-level authorization              | Done    | Backend `_visibleFields` stripping + client guards                     |
| Optimistic CRUD + conflict handling    | Done    | Optimistic delete/restore and per-field conflict resolution            |
| Resource search in command menu        | Partial | Works via parallel resource list queries; dedicated endpoint unused    |
| Notifications                          | Partial | Backend + panel exist; header/layout integration still missing         |
| Queued actions                         | Partial | Prototype exists; generated resource UI still uses synchronous actions |
| Audit logging                          | Partial | Resource audit stream exists; legacy admin audit path still separate   |
| Live relation peek                     | Partial | Preview modal is live; relation popover still one-shot                 |
| Full-width fields                      | Missing | Only remaining field UI trait gap                                      |
| WYSIWYG / repeater / timezone fields   | Missing | Still not implemented                                                  |
| Missing relation types                 | Missing | `HasOne`, `HasOneThrough`, `HasManyThrough`, `MorphedByMany`           |
| Multiple dashboards                    | Missing | Single dashboard remains intentional for now                           |

---

## Migration Path

### Strategy: Gradual Coexistence

Existing pages (`/admin/users`, `/admin/support`, `/admin/settings`, `/admin/dashboard`) are the equivalent of Nova "tools" — fully custom pages. They keep their own routes and components. New resource-driven pages use `[resource=resource]/` dynamic routes. Both coexist naturally in the sidebar.

The generated resource pages are the canonical Nova parity target. Custom pages do not need to be forced into the resource abstraction if custom UI is the better fit.

**Migration order:**

1. Keep polishing the generated resource path until it covers the Nova checklist end-to-end
2. Use demo resources as the exhaustive feature surface for parity testing
3. Port real CRUD/admin resources when the abstraction is a net gain
4. Keep custom tools like support custom where the UX warrants it

### Existing Convex Functions

The generic resource system **wraps** existing functions, not replaces. Each resource's Convex file can call existing query/mutation functions internally while presenting the standard resource interface.

---

## Implementation Priority

1. **Phase 1 — Core framework**: `defineResource`, `defineField`, field component registry, `FieldRenderer`, `createDynamicForm`
2. **Phase 2 — Resource Index**: `ResourceIndex.svelte` wrapping `ConvexCursorTableShell`, shared `applyResourceQuery()`, param matcher, resource registry, sidebar generation
3. **Phase 3 — CRUD**: `ResourceDetail`, `ResourceCreate`, `ResourceEdit`, shared `applyResourceMutation()`, tab panels, dependent fields, validation error mapping
4. **Phase 4 — Actions & Filters**: `defineAction`, `defineFilter`, `ActionModal`, `FilterPanel`, inline editing support
5. **Phase 5 — Metrics**: `defineMetric`, metric components, `@convex-dev/aggregate` integration, dashboard integration
6. **Phase 6 — Authorization**: `createAccessControl` setup, `permissionQuery` builder, resource/field `canSee`, action `canRun`
7. **Phase 7 — Polish**: Mount notifications/action jobs, convert relation peek to live subscriptions, unify audit feeds, finish checklist gaps
8. **Phase 8 — Durable background work**: Replace queued action prototype with `@convex-dev/workpool` where batch work needs retries/concurrency control
9. **Phase 9 — Migration**: Convert real resources to definitions where appropriate; keep custom tools custom
