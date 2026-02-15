# Nova to SvelteKit/Convex Admin Framework Mapping

## Core Parity

- `Nova Resource` -> `ResourceDefinition` in `src/lib/admin/resources/*.ts`
- `fields()` -> `fields: FieldDefinition[]` with `labelKey` i18n keys
- `filters()` -> `filters: FilterDefinition[]` with URL state sync
- `actions()` -> `actions: ActionDefinition[]` + `run<Action>Action` Convex mutations
- `lenses()` -> `lenses: LensDefinition[]` via `lens` URL param and backend filtering
- `cards()/metrics()` -> `metrics: MetricDefinition[]` + resource metric queries
- `softDeletes()` -> `deletedAt` + `trashed` filter + restore/force-delete mutations
- `replicate()` -> `replicate<Resource>` mutations

## Relationship Mapping

- `belongsTo` -> `v.id('<table>')` + relation option query
- `hasMany` -> derived count/details in resource detail payload
- `manyToMany` -> pivot table (`adminDemoProjectTags`) + attach/detach mutations
- `morphTo` -> discriminated union:
  - `target: { kind: 'project' | 'task', id: Id<'...'> }`
  - per-kind indexes: `by_target_project`, `by_target_task`
  - resolver: switch on `target.kind`

## UX and Runtime Mapping

- Nova polling -> intentionally omitted (Convex realtime subscriptions)
- Resource index state -> `createConvexCursorTable` + `ConvexCursorTableShell`
- Server field visibility -> `_visibleFields` in list/detail payloads
- Admin navigation/search -> dynamic entries from registry appended below existing custom admin pages

## Authorization Mapping

- Nova policies/gates -> statement checks in `src/lib/convex/adminFramework/access.ts`
- Enforcement points:
  - resource queries/mutations
  - action execution
  - relationship attach/detach
  - metric reads
