# Nova vs Admin Framework — Comparison State

Living document tracking alignment between Laravel Nova (`references/vendor/laravel/nova/`) and our SvelteKit + Convex admin framework. Update this file whenever admin framework features are added or changed.

---

## 1. Resource Definition — Aligned (with gaps)

| Aspect           | Nova                                               | Ours                                                             |
| ---------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| Definition       | PHP class extending `Resource`                     | `ResourceDefinition` object via `defineResource()`               |
| Discovery        | `Nova::resourcesIn()` auto-discovers PHP classes   | `import.meta.glob('./resources/*.ts')` auto-discovers TS modules |
| Model binding    | `static $model = User::class`                      | `table: 'adminDemoProjects'` (Convex table name)                 |
| Title            | `static $title = 'name'` (column name)             | `title: (record) => string` (function — more flexible)           |
| Subtitle         | `subtitle()` method (string)                       | `subtitle?: (record) => string`                                  |
| Search columns   | `static $search = [...]`                           | `search: [...]`                                                  |
| Sort fields      | N/A (all Eloquent columns sortable)                | `sortFields: [...]` explicit list                                |
| Per-page options | `$perPageOptions = [25, 50, 100]`                  | `perPageOptions: [5, 10, 20, 50, 100]`                           |
| Click action     | `$clickAction` (detail/edit/select/preview/ignore) | `clickAction` (same options)                                     |
| Soft deletes     | Auto-detected via `SoftDeletes` trait              | `softDeletes: boolean` (explicit)                                |
| Replication      | `replicate()` method on Resource                   | `replicate` mutation in `ResourceRuntime` + detail page button   |
| Eager loading    | `$with = [...]` (Eloquent)                         | N/A — Convex resolves relations per-query                        |
| Debounce         | `$debounce = 0.5` (global)                         | Debounced search input (client-side)                             |

### Resource display options

| Aspect                | Nova                                                                      | Ours                                         |
| --------------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| Table style           | `$tableStyle` ('tight' / 'default')                                       | Missing                                      |
| Column borders        | `$showColumnBorders`                                                      | Missing                                      |
| Redirect after CRUD   | `redirectAfterCreate()`, `redirectAfterUpdate()`, `redirectAfterDelete()` | Missing — hardcoded to detail/list           |
| Button labels         | `createButtonLabel()`, `updateButtonLabel()`                              | Missing — uses i18n keys only                |
| Per-page via relation | `$perPageViaRelationshipOptions`                                          | Missing (related tables use fixed page size) |

Architectural difference (class inheritance vs object literals) — idiomatic to each stack.

---

## 2. Field System — Aligned (with gaps)

| Aspect               | Nova                                                        | Ours                                                                                                                  |
| -------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Definition           | `Text::make('Name')` fluent builder                         | `defineField({ type: 'text', attribute: 'name' })`                                                                    |
| Visibility           | `showOnIndex()`, `hideFromDetail()` fluent methods          | `showOnIndex`, `showOnDetail`, `showOnForm` booleans                                                                  |
| Context dispatch     | `fieldsForIndex()` method overrides                         | `fieldComponentMap[type][context]` registry                                                                           |
| Validation           | `->rules([...])`, `->creationRules([...])` per field        | Valibot schemas in `DynamicFormState.validate()`                                                                      |
| Fill (write)         | Per-field `fill()` method                                   | `fillUsing(value, values, attribute)` per field in `normalizeFormValues()`                                            |
| Resolve (read)       | `resolveUsing()` / `displayUsing()` callbacks               | `resolveUsing(value, record, attribute)` / `displayUsing(value, record, attribute)` via `resolveFieldValue()` utility |
| Custom render        | `$component` maps to Vue component                          | `renderOverride: { index: MyComponent }`                                                                              |
| Index column layout  | Width/behavior via custom field classes                     | `indexColumn` per field (`preset`, width overrides, fixed/fluid)                                                      |
| Dependent fields     | `SupportsDependentFields` trait (show/hide based on values) | `dependsOn: { field, value?, predicate? }` on `FieldDefinition`                                                       |
| Readonly / Immutable | `->readonly()`, no separate immutable                       | `readonly` (dynamic) + `immutable` (lock after create)                                                                |
| Security level       | N/A (server-rendered)                                       | `securityLevel: 'server' \| 'client'` controls data stripping                                                         |
| Help text            | `->helpText('...')`                                         | `helpTextKey` (i18n)                                                                                                  |
| Placeholder          | `->placeholder('...')`                                      | `placeholderKey` (i18n)                                                                                               |

### Field UI traits — gaps

| Nova trait                | Description                          | Ours    |
| ------------------------- | ------------------------------------ | ------- |
| `Peekable`                | Quick-look modal for relation fields | Missing |
| `Copyable`                | Copy field value to clipboard        | Missing |
| `Expandable`              | Expand long text inline              | Missing |
| `Collapsable`             | Collapse field section               | Missing |
| `HasSuggestions`          | Autocomplete suggestions             | Missing |
| `SupportsFullWidthFields` | Full-width field rendering           | Missing |
| `SupportsMaxlength`       | Max length indicator                 | Missing |

---

## 3. Field Types — Aligned (with gaps)

| Status  | Nova                                               | Ours                                                             |
| ------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| Aligned | Text, Textarea, Number, Email, URL, Date, DateTime | `text`, `textarea`, `number`, `email`, `url`, `date`, `datetime` |
| Aligned | Select, MultiSelect, Boolean                       | `select`, `multiselect`, `boolean`                               |
| Aligned | File, Image, Avatar                                | `image`, `file`, `avatar`                                        |
| Aligned | Status, Badge                                      | `badge`, `status`                                                |
| Aligned | Password, Hidden                                   | `password`, `hidden`                                             |
| Aligned | Currency, Color, Slug                              | `currency`, `color`, `slug`                                      |
| Aligned | Heading                                            | `heading`                                                        |
| Aligned | KeyValue, BooleanGroup                             | `keyValue`, `booleanGroup`                                       |
| Aligned | BelongsTo, HasMany, MorphTo                        | `belongsTo`, `hasMany`, `manyToMany`, `morphTo`                  |
| Aligned | ID                                                 | `id`                                                             |
| Aligned | Markdown                                           | `markdown`                                                       |
| Aligned | Code (editor)                                      | `code`, `json` (lazy-loaded editors)                             |
| Missing | Trix (WYSIWYG rich text)                           | —                                                                |
| Missing | Repeater (nested repeatable fields)                | —                                                                |
| Missing | Timezone (timezone selector)                       | —                                                                |
| Missing | Tag (tag input)                                    | —                                                                |
| Missing | Gravatar / UiAvatar                                | `avatar` covers basics; no Gravatar API                          |
| Missing | Stack (visual field stacking)                      | — (niche display-only)                                           |
| Missing | Sparkline (inline chart)                           | — (niche display-only)                                           |
| Aligned | Line (visual divider)                              | `line` — display-only `<Separator/>`, no data storage            |
| N/A     | Token                                              | Not needed                                                       |

### Relationship types

| Nova           | Ours         | Notes                                      |
| -------------- | ------------ | ------------------------------------------ |
| BelongsTo      | `belongsTo`  | Aligned                                    |
| HasMany        | `hasMany`    | Aligned — renders inline table             |
| MorphTo        | `morphTo`    | Aligned — kind:id encoding, multi-resource |
| BelongsToMany  | `manyToMany` | Aligned (different name)                   |
| HasOne         | —            | Missing                                    |
| HasOneThrough  | —            | Missing                                    |
| HasManyThrough | —            | Missing                                    |
| MorphedByMany  | —            | Missing                                    |

### Relatable authorization

Nova's `Relatable` trait provides per-relation `relatableXxx()` methods to control whether a user can attach/detach. Our equivalent:

| Nova                           | Ours                                                         | Notes                             |
| ------------------------------ | ------------------------------------------------------------ | --------------------------------- |
| `relatableXxx()` query scope   | `canAttach` / `canDetach` / `canAdd` on `relation` config    | Aligned — declarative callbacks   |
| Attach/detach policy methods   | `assertRelationAllowed()` backend guard                      | Aligned — enforced in mutations   |
| Frontend attach button control | `isRelationAddable()` / `isRelationAttachable()` visibility  | Aligned                           |
| Frontend detach button control | `isRelationDetachable()` visibility helper                   | Aligned                           |

---

## 4. CRUD Operations — Aligned (ours is stronger)

| Aspect    | Nova                                         | Ours                                                                  |
| --------- | -------------------------------------------- | --------------------------------------------------------------------- |
| List      | Controller → Eloquent → paginate → serialize | Convex subscription → cursor pagination → TanStack table              |
| Create    | Auth → Validate → Fill → Save (transaction)  | Validate (Valibot) → Normalize → Convex mutation                      |
| Update    | Traffic cop (409 on stale)                   | Real-time per-field conflict resolution via `$effect` + `dirtyFields` |
| Delete    | Soft delete + force delete + restore         | Same + optimistic updates                                             |
| Replicate | `replicate()` duplicates record              | `runtime.replicate` mutation + UI button on detail                    |
| SSR       | N/A (SPA)                                    | `+page.server.ts` prefetches via HTTP Convex client                   |

### Our advantages

- **Per-field conflict resolution** instead of Nova's all-or-nothing 409 reject. Enabled by Convex real-time.
- **Optimistic updates** for delete/restore (Nova reloads the list).
- **SSR prefetch** for faster initial paint.

---

## 5. Pagination & Query Building — Different by Architecture

| Aspect                | Nova                                    | Ours                                                                   |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Pagination            | Offset-based (`?page=2`)                | Cursor-based with page cache + prefetch + persisted page size          |
| Search                | `WHERE LIKE` / Laravel Scout            | Convex search index (full-text) with debounced input                   |
| Sort                  | `ORDER BY` on Eloquent                  | `sortBy` param → 3-tier query strategy (index → search → full collect) |
| Filters               | `Filter::apply()` mutates query builder | URL filter values → Convex query args                                  |
| Query hooks           | `indexQuery()` etc. overrideable        | Backend handler has full control                                       |
| Per-page via relation | `$perPageViaRelationshipOptions`        | Fixed per related table                                                |

Cursor pagination with page cache + prefetch is more sophisticated than Nova's offset pagination.

---

## 6. Filters — Aligned (with gaps)

| Aspect            | Nova                                                         | Ours                                                                                          |
| ----------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Types             | `SelectFilter`, `BooleanFilter`, `DateFilter`, `RangeFilter` | `select`, `boolean`, `date-range`                                                             |
| Field-driven      | `->filterable()` on any field auto-generates filter          | `filterable: true \| FilterableConfig` on `FieldDefinition` auto-generates `FilterDefinition` |
| Default value     | `Filter::default()`                                          | URL schema defaults                                                                           |
| Explicit override | N/A                                                          | Explicit `filters` array entries take precedence over auto-generated (dedup by `urlKey`)      |
| Searchable filter | `Searchable` trait on filter (for large option lists)        | Missing                                                                                       |

### Gap

- **No numeric range filter** — Nova has `RangeFilter` for numeric min/max. We only have `date-range`.

---

## 7. Actions — Aligned

| Aspect              | Nova                                                            | Ours                                                                                          |
| ------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Definition          | `Action` class with `handle()` + `fields()`                     | `ActionDefinition` object with `key`, `fields`, visibility flags                              |
| Visibility          | `showOnIndex()`, `showOnDetail()`, `showInline()`               | `showOnIndex`, `showOnDetail`, `showInline`                                                   |
| Standalone / Sole   | `->standalone()`, `->sole()`                                    | `standalone: true`, `sole: true`                                                              |
| Confirmation        | Default confirm, `->withoutConfirmation()`                      | `withoutConfirmation: true`                                                                   |
| Response types      | message, danger, redirect, download, modal, visit, openInNewTab | message, danger, redirect, download, modal, event                                             |
| Destructive variant | `DestructiveAction` subclass (red UI, delete auth)              | `defineDestructiveAction()` + `run-destructive` permission + red UI                           |
| Batch chunking      | 200 models per chunk                                            | 50 IDs per chunk (configurable via `chunkSize`), frontend-driven with progress + cancellation |
| Authorization       | `->canRun(Closure)` per-model                                   | `canRun?(user, record?)` per-action                                                           |
| Modal style         | `FULLSCREEN_STYLE`, `WINDOW_STYLE` constants                    | `modalStyle: 'window' \| 'fullscreen'`, `modalSize: 'sm' \| 'md' \| 'lg' \| 'xl' \| '2xl'`  |
| Queued actions      | `ShouldQueue` interface for background jobs                     | Missing — all actions run synchronously                                                       |

---

## 8. Lenses — Partial

| Aspect              | Nova                                                              | Ours                                          |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| Definition          | `Lens` class with `query()`, `fields()`, `filters()`, `actions()` | `LensDefinition` with `key`, filter overrides |
| Custom query        | Complete query override                                           | Backend interprets `lens` param               |
| Own fields          | Lens defines different fields                                     | Not supported — lenses use resource fields    |
| Own actions/filters | Yes                                                               | Actions overrideable, not filters             |

### Gap

- **No lens field overrides** — our lenses are preset filter views. Nova lenses can show entirely different columns (e.g. computed profit column). Extend `LensDefinition` if needed.

---

## 9. Metrics — Aligned (with gaps)

| Aspect                | Nova                                     | Ours                                                                |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Types                 | Value, Trend, Partition, Progress, Table | `value`, `trend`, `partition`, `progress`, `table`                  |
| Ranges                | Dropdown (30d, 60d, MTD, YTD)            | Configurable per metric via `rangeOptions`                          |
| Previous period       | Auto-computed % change                   | Supported via `getMetrics`                                          |
| Placement             | Resource cards + Dashboard cards         | Resource list page + admin dashboard                                |
| Progress display      | Linear bar only                          | `bar` (default) or `radial` (ArcChart)                              |
| Progress `avoid` mode | Inverts color logic                      | `avoid?: boolean` on `MetricDefinition`                             |
| Progress colors       | Nova green/yellow/red                    | Emerald ≥75%, amber 50-74%, destructive <50% (inverted for `avoid`) |
| Format                | Number, currency via PHP formatting      | `format: 'number' \| 'currency' \| 'percent'`                       |
| Caching               | `cacheFor()` duration                    | N/A — always live via Convex subscription (superior)                |
| Refresh on action     | `$refreshWhenActionRuns`                 | N/A — Convex subscriptions auto-refresh on any data change          |
| Refresh on filter     | `$refreshWhenFiltersChange`              | N/A — metric queries re-run reactively when filter args change      |
| Detail-only           | `onlyOnDetail` flag                      | Missing — metrics only on list page                                 |
| Real-time aggregates  | N/A (compute on request)                 | `@convex-dev/aggregate` for live counts/sums                        |

### Our advantage

- **Real-time aggregates** — metric values update instantly via Convex subscriptions; Nova recomputes on page load or polling.
- **Radial progress** — `display: 'radial'` option not available in Nova.

---

## 10. Authorization — Aligned (ours is stronger)

| Aspect         | Nova                         | Ours                                            |
| -------------- | ---------------------------- | ----------------------------------------------- |
| Global gate    | `Nova::auth()` callback      | `hooks.server.ts` role check                    |
| Resource-level | Laravel Policy               | `canSee`, `canCreate`, `canUpdate`, `canDelete` |
| Field-level    | `canSee(Closure)`            | `canSee(user, record?)` + backend `FieldPolicy` |
| Per-row auth   | Auth flags in index response | Client guards + backend strips data             |
| Backend        | Policy checks in controllers | `assertPermission()` in every query/mutation    |

### Our advantage

4-layer auth (route → client visibility → backend RBAC → field-level data stripping) vs Nova's 2 layers. Server-enforced `_visibleFields` stripping means the data isn't even sent if unauthorized — Nova trusts the frontend.

---

## 11. Navigation / Sidebar — Aligned

| Aspect         | Nova                                 | Ours                               |
| -------------- | ------------------------------------ | ---------------------------------- |
| Structure      | `MenuSection` → `MenuItem`           | `navGroups` → `navItems`           |
| Grouping       | `static $group` on resource          | `groupKey` → `getResourceGroups()` |
| Icons          | Heroicons string name                | Lucide component import            |
| Badges         | Not built-in                         | Live Convex count queries          |
| Auto-generated | From `$group`                        | From `groupKey` + auto-discovery   |
| Breadcrumbs    | `Breadcrumb` / `Breadcrumbs` classes | Implemented on detail/edit pages   |

### Our advantage

Live sidebar badge counts from Convex subscriptions.

---

## 12. Panels / Field Groups — Aligned (ours is stronger)

| Aspect          | Nova                                     | Ours                                       |
| --------------- | ---------------------------------------- | ------------------------------------------ |
| Grouping        | `Panel::make('Details', [...fields])`    | `fieldGroups: [{ key, contexts, fields }]` |
| Tabs            | `TabsGroup` special panel                | Rendered via `resolveFieldGroups()`        |
| Context control | Panels on all views where fields visible | `contexts: ['form', 'detail']` per group   |

### Our advantage

Per-context group control — show a group on form but not detail, or vice versa.

---

## 13. Inline Editing — Aligned

| Aspect       | Nova                                         | Ours                                                  |
| ------------ | -------------------------------------------- | ----------------------------------------------------- |
| Support      | Field update controller, inline cell editing | `inlineEditable: boolean` per field                   |
| Confirmation | N/A                                          | `inlineConfirmation: boolean` optional confirm dialog |
| Validation   | Server-side validation on update             | Client-side validation + Convex mutation              |
| Field types  | Text, Select, Boolean supported              | All field types via `InlineEditCell` component        |

---

## 14. Export — Aligned (ours is stronger)

| Aspect               | Nova                            | Ours                                                |
| -------------------- | ------------------------------- | --------------------------------------------------- |
| CSV                  | `ExportAsCsv` action (built-in) | `createCsvFromRows()` with injection escaping       |
| JSON                 | Not built-in                    | `createJsonFromRows()` with field resolution        |
| Custom query         | `withQuery()` callback          | Full field-aware resolution via `resolveFieldValue` |
| Custom fields        | `withFields()` callback         | Uses resource field definitions                     |
| File naming          | `nameable()` for user input     | `downloadTextFile(data, filename)`                  |
| Format selector      | `withTypeSelector()` (CSV/XLSX) | CSV + JSON formats                                  |
| Injection protection | N/A                             | Escapes `=`, `+`, `-`, `@`, tab, CR in CSV cells    |

### Our advantage

- **CSV injection protection** — Nova's export doesn't escape formula injection characters.
- **JSON export** — Nova only supports CSV/XLSX.

---

## 15. Dependent Fields — Aligned

| Aspect           | Nova                            | Ours                                                      |
| ---------------- | ------------------------------- | --------------------------------------------------------- |
| Show/hide        | `SupportsDependentFields` trait | `dependsOn: { field, value?, predicate? }`                |
| Value matching   | Callback-based                  | `value` exact match or `predicate(currentValues)`         |
| Form integration | Automatic via trait             | `getVisibleFormFields()` + `isFieldDependencySatisfied()` |

---

## 16. Global Search — Gap (can build better)

| Aspect                | Nova                                                               | Ours    |
| --------------------- | ------------------------------------------------------------------ | ------- |
| Cross-resource search | `GlobalSearch.php` with avatar + subtitle                          | Missing |
| Resource opt-in       | `$globallySearchable`, `$globalSearchResults`, `$globalSearchLink` | Missing |
| Result display        | Resource name, title, subtitle, avatar, link                       | Missing |

Nova's global search searches across all resources from a single search bar. We only support per-resource search on the list page.

**Implementation opportunity:** Convex full-text search indexes + our existing `title()`/`subtitle()` per resource make this straightforward. A single command palette component could query all `globallySearchable` resources in parallel via Convex subscriptions, delivering instant results as the user types — superior to Nova's server-round-trip approach.

---

## 17. Notifications — Gap (can build better)

| Aspect               | Nova                                                                  | Ours    |
| -------------------- | --------------------------------------------------------------------- | ------- |
| In-app notifications | `nova_notifications` table, `NovaChannel`, read/unread tracking       | Missing |
| Notification display | Bell icon with unread count, notification center                      | Missing |
| Programmatic send    | `NovaNotification::make()` with types (info, success, warning, error) | Missing |

Nova provides a built-in notification system for sending in-app messages to admin users. We have no equivalent.

**Implementation opportunity:** A Convex `adminNotifications` table + subscription would deliver real-time notification updates instantly (bell icon count updates without polling). Nova notifications require page refresh or polling to appear.

---

## 18. Dashboard — Partial (ours is live)

| Aspect              | Nova                                           | Ours                                                        |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Dedicated page      | `Dashboard` class with `cards()` method        | `/admin/dashboard/` with global metrics + resource overview |
| Multiple dashboards | Yes — register multiple `Dashboard` subclasses | Single admin dashboard                                      |
| Dashboard cards     | Any metric/card type                           | Value metrics + resource counts + service links             |
| Refresh button      | `$showRefreshButton`                           | N/A — Convex real-time (superior)                           |

### Our advantage

Metrics on the dashboard are live via Convex subscriptions; Nova dashboards must refresh or poll. Multiple dashboards is the only gap — straightforward to add if needed.

---

## 19. Polling vs Real-time — Different by Architecture

| Aspect    | Nova                                | Ours                           |
| --------- | ----------------------------------- | ------------------------------ |
| Mechanism | Polling via `SupportsPolling` trait | Convex real-time subscriptions |
| Interval  | `$pollingInterval` (default 15s)    | Instant — subscription-based   |
| Toggle    | `$showPollingToggle` UI control     | N/A — always live              |
| Scope     | Per-resource opt-in                 | All queries auto-subscribe     |

### Our advantage

Real-time data via Convex subscriptions is fundamentally superior to polling. Zero latency for data changes, no wasted requests, no toggle needed.

---

## 20. Audit Logging / Action Events — Gap (can build better)

| Aspect                | Nova                                                         | Ours    |
| --------------------- | ------------------------------------------------------------ | ------- |
| Action event tracking | `action_events` table logging all CRUD operations            | Missing |
| Tracked data          | Who, what, when, batch ID, original vs changes, status       | Missing |
| Event types           | Create, Update, Delete, Restore, ForceDelete, Attach, Detach | Missing |
| Pruning               | `ActionEvent::prune()` for cleanup                           | Missing |

Nova automatically logs every CRUD operation with before/after snapshots. We have no audit trail.

**Implementation opportunity:** Our `permissionMutation` wrapper already intercepts all CRUD operations with the authenticated user. Adding an `adminAuditLog` Convex table + a write inside the wrapper would capture who/what/when/changes with minimal code. Convex subscriptions would then power a real-time audit feed — Nova's audit log is only visible on page load.

---

## 21. Resource Lifecycle Hooks — Architectural Alternative

| Aspect | Nova                                                                                                                                                   | Ours                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Hooks  | `beforeCreate/afterCreate`, `beforeUpdate/afterUpdate`, `beforeDelete/afterDelete`, `beforeForceDelete/afterForceDelete`, `beforeRestore/afterRestore` | Backend mutations handle logic inline |
| Scope  | Resource-level (PHP class methods)                                                                                                                     | Per-resource mutation functions       |

Nova resources have declarative lifecycle hooks on a class. Our Convex mutations contain the same logic inline — the mutation _is_ the lifecycle handler. This is an architectural difference, not a gap: Convex mutations are atomic transactions, so "before" logic and the operation itself are guaranteed to succeed or fail together. Nova's hooks can have partial failure if `afterCreate` throws after the record is already saved.

**If declarative hooks are desired:** Add optional `beforeSave`/`afterSave` callbacks to `ResourceRuntime` and call them inside `permissionMutation`. Low priority since inline mutations already work well.

---

## 22. Impersonation — Gap (Better Auth supports it)

| Aspect             | Nova                                               | Ours    |
| ------------------ | -------------------------------------------------- | ------- |
| User impersonation | `ImpersonateController` + session management       | Missing |
| Controls           | `canImpersonate()`, `canBeImpersonated()` per user | Missing |
| UI                 | Start/stop impersonation, redirect callbacks       | Missing |

**Implementation opportunity:** Better Auth has built-in [admin impersonation](https://www.better-auth.com/docs/plugins/admin#impersonate-user) via `authClient.admin.impersonateUser()` / `stopImpersonating()`. The auth layer already supports it — only the admin UI (button on user detail, impersonation banner) needs to be built.

---

## 23. Peek / Preview — Gap (can build better)

| Aspect           | Nova                                                   | Ours                                          |
| ---------------- | ------------------------------------------------------ | --------------------------------------------- |
| Peek modal       | `Peekable` trait on relation fields — quick-look popup | Missing                                       |
| Resource preview | `serializeForPreview()` / `serializeForPeeking()`      | Detail page has preview section (not a modal) |
| Preview fields   | `previewFields()` method customizes preview content    | Missing                                       |

**Implementation opportunity:** A popover/dialog that fetches the related record via existing `runtime.getById` and renders its `showOnDetail` fields. Convex subscriptions mean the peek content stays live while open — Nova's peek is a static snapshot.

---

## 24. I18n — Ours is Stronger

| Aspect        | Nova                                             | Ours                                                                  |
| ------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| Framework     | Built-in Laravel translation (`resources/lang/`) | Tolgee cloud + in-context editing                                     |
| Field labels  | Translation keys via `->withMeta()`              | `labelKey`, `helpTextKey`, `placeholderKey`, `ariaLabelKey` per field |
| Accessibility | No built-in a11y localization                    | All `aria-label` and `.sr-only` text localized                        |
| Languages     | Single locale per deployment                     | Multi-locale with URL-based routing (`/en/`, `/de/`, `/es/`, `/fr/`)  |
| Management    | JSON/PHP files                                   | Tolgee cloud dashboard with tagging                                   |

### Our advantage

Full accessibility localization, multi-language URL routing, cloud translation management, and in-context editing — Nova has basic PHP translation files only.

---

## Open Gaps Summary

### Superseded by Convex real-time (N/A)

These Nova features exist to work around the request/response model. Our Convex subscription architecture makes them unnecessary.

| Nova feature                                    | Why N/A                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| Metric caching (`cacheFor()`)                   | Metrics are live Convex subscriptions — always fresh, no cache needed |
| Refresh on action (`$refreshWhenActionRuns`)    | Convex subscriptions auto-update when underlying data changes         |
| Refresh on filter (`$refreshWhenFiltersChange`) | Metric queries re-run reactively when filter args change              |
| Polling (`$polling`, `$pollingInterval`)        | All queries are real-time subscriptions — polling is obsolete         |
| Dashboard refresh button (`$showRefreshButton`) | Dashboard metrics are live — no manual refresh needed                 |

### Can build a better solution (our architecture enables a superior version)

These are genuinely missing features, but Convex real-time + our existing infrastructure means we can surpass Nova's implementation when we build them.

| #   | Gap                 | How we'd surpass Nova                                                                                                 | Priority |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Global search       | Command palette with parallel Convex full-text queries across resources — instant results vs Nova's server round-trip | Medium   |
| 2   | Audit logging       | `adminAuditLog` table inside `permissionMutation` wrapper — real-time audit feed vs Nova's static page                | Medium   |
| 3   | Notifications       | `adminNotifications` table + subscription — live bell count vs Nova's polling/refresh                                 | Low      |
| 4   | Impersonation       | Better Auth already supports `admin.impersonateUser()` — just needs UI (button + banner)                              | Low      |
| 5   | Peek/Preview modals | Popover with `runtime.getById` subscription — live peek content vs Nova's static snapshot                             | Low      |

### Architectural alternative (different approach, not a gap)

| Nova feature                                 | Our approach                           | Notes                                                                                                                                                                                                     |
| -------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle hooks (`before/afterCreate`, etc.) | Logic lives inline in Convex mutations | Convex mutations are atomic transactions — "before" + operation succeed/fail together. Nova hooks can have partial failure. Add optional callbacks to `ResourceRuntime` if declarative hooks are desired. |

### Genuinely missing features

| #   | Gap                        | Description                                                                 | Priority |
| --- | -------------------------- | --------------------------------------------------------------------------- | -------- |
| 1   | Lens field overrides       | Lenses with custom columns (Nova lenses can show entirely different fields) | Low      |
| 2   | WYSIWYG field              | Rich text editing (Trix equivalent)                                         | Low      |
| 3   | Repeater field             | Nested repeatable field groups                                              | Low      |
| 4   | Numeric range filter       | `RangeFilter` for min/max number filtering                                  | Low      |
| 5   | Copyable fields            | Copy-to-clipboard on index/detail                                           | Low      |
| 6   | Field UI traits            | Expandable, Collapsable, Suggestions, FullWidth, Maxlength                  | Low      |
| 7   | ~~Action modal styles~~    | ~~Fullscreen/window modal variants~~ — Implemented via `modalStyle`/`modalSize` on `ActionDefinition` | Done     |
| 8   | Queued actions             | Background job processing (Convex scheduled functions could power this)     | Low      |
| 9   | Table style options        | `tableStyle` (tight/default), `showColumnBorders`                           | Low      |
| 10  | Redirect customization     | `redirectAfterCreate/Update/Delete` callbacks                               | Low      |
| 11  | Detail-only metrics        | `onlyOnDetail` flag for metrics                                             | Low      |
| 12  | Missing relation types     | HasOne, HasOneThrough, HasManyThrough, MorphedByMany                        | Low      |
| 13  | Missing field types        | Timezone, Tag                                                               | Low      |
| 14  | Multiple dashboards        | Register multiple dashboard pages (we have one)                             | Low      |
| 15  | Button label customization | `createButtonLabel`, `updateButtonLabel` overrides                          | Low      |
| 16  | Per-page via relation      | `$perPageViaRelationshipOptions` for related tables                         | Low      |

### Resolved gaps

| Gap                                 | Resolution                                                          |
| ----------------------------------- | ------------------------------------------------------------------- |
| ~~Filterable fields~~               | `filterable: true \| FilterableConfig` on `FieldDefinition`         |
| ~~Field resolve/display callbacks~~ | `resolveUsing` / `displayUsing` / `fillUsing`                       |
| ~~DestructiveAction~~               | `defineDestructiveAction()` + `run-destructive` permission + red UI |
| ~~Per-field fill logic~~            | `fillUsing(value, values, attribute)` callback                      |
| ~~Batch chunking~~                  | 50 IDs/chunk, configurable, with progress + cancellation            |
| ~~Code field~~                      | `code` and `json` field types with lazy-loaded editors              |
| ~~Line field~~                      | `line` type — display-only `<Separator/>`, no data storage          |

---

## Our Unique Advantages (not in Nova)

| Feature                       | Description                                                             |
| ----------------------------- | ----------------------------------------------------------------------- |
| Real-time subscriptions       | All data live via Convex — no polling needed                            |
| Per-field conflict resolution | Merge server updates into non-dirty fields instead of 409 reject        |
| Optimistic updates            | Instant UI feedback for delete/restore/force-delete                     |
| SSR prefetch                  | `+page.server.ts` for faster initial paint                              |
| Live sidebar badges           | Real-time count queries via Convex aggregates                           |
| Real-time aggregates          | `@convex-dev/aggregate` for instant metric updates                      |
| Radial progress metric        | `display: 'radial'` option                                              |
| CSV injection protection      | Export escapes formula injection characters                             |
| JSON export                   | In addition to CSV                                                      |
| 4-layer authorization         | Route → client → backend RBAC → field-level data stripping              |
| Per-context field groups      | `contexts` array controls which views show each group                   |
| Multi-locale URL routing      | `/en/`, `/de/`, `/es/`, `/fr/` with Tolgee cloud management             |
| Accessibility localization    | All aria-label/sr-only text localized                                   |
| Field security levels         | `securityLevel: 'server' \| 'client'` controls data exposure            |
| Immutable fields              | `immutable` locks field after initial create (distinct from `readonly`) |

---

## Changelog

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-02 | Added `modalStyle` (`window` / `fullscreen`) and `modalSize` (`sm`–`2xl`) options to `ActionDefinition`. Window mode maps size to `sm:max-w-{size}`. Fullscreen fills viewport. Demo: `attachTag` action on demo-projects uses `modalSize: 'xl'`. |
| 2026-03-02 | Added **relatable authorization**: per-relation `canAdd`/`canAttach`/`canDetach` guards on `FieldDefinition.relation`. Frontend visibility helpers (`isRelationAddable`, `isRelationAttachable`, `isRelationDetachable`). Backend `assertRelationAllowed()` guard wired into attach/detach mutations and bulk actions. Demo: `canDetach` blocks tag removal from archived projects. |
| 2026-02-19 | **Major audit**: Added 12 new comparison sections (13–24). Recategorized gaps into 4 tiers: superseded by Convex real-time (5 items N/A), can build better (5 items), architectural alternative (1 item), genuinely missing (16 items). Added implementation opportunity notes for global search, audit logging, notifications, impersonation, peek/preview. Reclassified lifecycle hooks as architectural alternative (not a gap). Marked metric caching/refresh as N/A. Added missing Nova features: global search, notifications, dashboard, polling, audit logging, lifecycle hooks, impersonation, peek/preview, repeater field, numeric range filter, field UI traits, action modal styles, queued actions, missing relation types. Added "Our Unique Advantages" summary. Fixed metrics section (Nova also has Table metric type). Added inline editing, export, dependent fields, and i18n comparison sections. |
| 2026-02-19 | Added 11 missing Nova field types: `password`, `color`, `slug`, `currency`, `hidden`, `keyValue`, `booleanGroup`, `multiselect`, `heading`, `status`, `avatar`. Includes form/detail/index rendering, inline editing for color+currency, layout presets, form normalization/validation, and i18n keys for all 4 locales.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-02-19 | Added batch chunking for admin actions and bulk operations. Default 50 IDs per chunk, configurable per-action via `chunkSize`. Frontend-driven with progress bar, cancellation, and partial failure reporting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-02-19 | Added `filterable: true \| FilterableConfig` on `FieldDefinition` to auto-generate `FilterDefinition` from field type/options. Explicit filters take precedence via `urlKey` dedup. Migrated demo-tasks and demo-projects as proof-of-concept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-02-19 | Aligned `resolveUsing`, `displayUsing`, `fillUsing` callbacks with Nova's `(value, resource, attribute)` pattern. Centralized resolve logic in `resolveFieldValue()` / `displayFieldValue()` utilities.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-02-19 | Added `defineDestructiveAction()` builder, `run-destructive` permission, and red UI styling for destructive actions on index/detail pages and action modal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-02-19 | Added per-field index table column layout overrides (`indexColumn`) and tightened default compact sizing for numeric and checkbox-like index columns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-02-19 | Fixed aggregate namespace isolation for admin resource metrics. Count/sum aggregates now use distinct namespace prefixes per metric family to avoid key collisions during trigger updates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-02-18 | Initial comparison created                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-02-18 | Table/support loading behavior improved: when cached count for current filter identity is `0`, list views render a blank placeholder while loading and fade in the empty message only after data resolves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
