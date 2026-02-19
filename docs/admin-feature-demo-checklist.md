# Admin Framework — Feature Demo Checklist

Comprehensive checklist of every admin framework feature. Each row tracks whether a demo resource demonstrates the feature, and provides a URL + test instructions for manual QA.

**Legend:** Checked = tested and looks great. Unchecked = not yet tested or not yet demoed.

---

## 1. Field Types

Every `FieldType` in `types.ts` should appear in at least one demo resource.

| #   | Field Type     | Demo Resource | Attribute       | URL                         | How to Test                                                                                                   | OK  |
| --- | -------------- | ------------- | --------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- | --- |
| 1   | `text`         | demo-projects | `name`          | `/admin/demo-projects`      | Visible in index table, editable in create/edit form                                                          | [ ] |
| 2   | `textarea`     | demo-comments | `text`          | `/admin/demo-comments`      | Visible in index, multi-line in form                                                                          | [ ] |
| 3   | `number`       | demo-projects | `budget`        | `/admin/demo-projects`      | Right-aligned in index, number input in form                                                                  | [ ] |
| 4   | `boolean`      | demo-projects | `isFeatured`    | `/admin/demo-projects`      | Badge on index, checkbox in form                                                                              | [ ] |
| 5   | `select`       | demo-projects | `status`        | `/admin/demo-projects`      | Badge on index, dropdown in form                                                                              | [ ] |
| 6   | `date`         | demo-projects | `createdAt`     | `/admin/demo-projects/{id}` | Formatted date on detail                                                                                      | [ ] |
| 7   | `datetime`     | demo-projects | `updatedAt`     | `/admin/demo-projects/{id}` | Formatted datetime on detail                                                                                  | [ ] |
| 8   | `image`        | demo-projects | `coverImageUrl` | `/admin/demo-projects/{id}` | Thumbnail on detail, upload on form                                                                           | [ ] |
| 9   | `file`         | demo-projects | `specSheetUrl`  | `/admin/demo-projects/{id}` | Download link on detail, upload on form                                                                       | [ ] |
| 10  | `email`        | demo-projects | `ownerEmail`    | `/admin/demo-projects`      | Displayed in index, email input in form                                                                       | [ ] |
| 11  | `url`          | —             | —               | —                           | _Not demoed — add to a resource_                                                                              | [ ] |
| 12  | `json`         | demo-projects | `settingsJson`  | `/admin/demo-projects/{id}` | JSON viewer on detail, JSON editor on form                                                                    | [ ] |
| 13  | `code`         | demo-projects | `codeSnippet`   | `/admin/demo-projects/{id}` | Code editor on detail/form (conditional via canSee)                                                           | [ ] |
| 14  | `markdown`     | demo-projects | `description`   | `/admin/demo-projects/{id}` | Rendered markdown on detail, markdown editor on form                                                          | [ ] |
| 15  | `badge`        | —             | —               | —                           | _Not demoed — add to a resource_                                                                              | [ ] |
| 16  | `belongsTo`    | demo-tasks    | `projectId`     | `/admin/demo-tasks`         | Shows related project name on index, dropdown on form                                                         | [ ] |
| 17  | `hasMany`      | demo-projects | `taskCount`     | `/admin/demo-projects`      | Count badge on index, related table on detail                                                                 | [ ] |
| 18  | `manyToMany`   | demo-projects | `tagIds`        | `/admin/demo-projects/{id}` | Tag list on detail, multi-select on form                                                                      | [ ] |
| 19  | `morphTo`      | demo-comments | `target`        | `/admin/demo-comments`      | Kind:title on index, polymorphic select on form                                                               | [ ] |
| 20  | `password`     | —             | —               | —                           | _Not demoed — add to a resource_                                                                              | [ ] |
| 21  | `color`        | —             | —               | —                           | _Not demoed — add to a resource (tags.color is `text`, should be `color`)_                                    | [ ] |
| 22  | `slug`         | —             | —               | —                           | _Not demoed — add to a resource (projects.slug is `text`, should be `slug`)_                                  | [ ] |
| 23  | `currency`     | —             | —               | —                           | _Not demoed — add to a resource (projects.budget is `number`, should be `currency`)_                          | [ ] |
| 24  | `hidden`       | —             | —               | —                           | _Not demoed — add to a resource_                                                                              | [ ] |
| 25  | `keyValue`     | —             | —               | —                           | _Not demoed — add to a resource_                                                                              | [ ] |
| 26  | `booleanGroup` | —             | —               | —                           | _Not demoed — add to a resource_                                                                              | [ ] |
| 27  | `multiselect`  | —             | —               | —                           | _Not demoed — add to a resource_                                                                              | [ ] |
| 28  | `heading`      | —             | —               | —                           | _Not demoed — add to a resource_                                                                              | [ ] |
| 29  | `status`       | —             | —               | —                           | _Not demoed — add to a resource (tasks.status or projects.status could use `status` type with statusMapping)_ | [ ] |
| 30  | `avatar`       | —             | —               | —                           | _Not demoed — add to a resource_                                                                              | [ ] |

---

## 2. Field Options

Per-field configuration options on `FieldDefinition`.

| #   | Option                               | Demo Resource | Field           | URL                              | How to Test                                                                          | OK  |
| --- | ------------------------------------ | ------------- | --------------- | -------------------------------- | ------------------------------------------------------------------------------------ | --- |
| 1   | `sortable`                           | demo-projects | `name`          | `/admin/demo-projects`           | Click column header to sort asc/desc/clear                                           | [ ] |
| 2   | `searchable`                         | demo-projects | `name`          | `/admin/demo-projects`           | Type in search box, results filter in real-time                                      | [ ] |
| 3   | `filterable` (bool)                  | demo-tasks    | `status`        | `/admin/demo-tasks`              | Auto-generated filter dropdown in filter panel                                       | [ ] |
| 4   | `filterable` (FilterableConfig)      | —             | —               | —                                | _Not demoed — add `filterable: { type, options }` config to a field_                 | [ ] |
| 5   | `showOnIndex: false`                 | demo-projects | `description`   | `/admin/demo-projects`           | Column not visible in index table                                                    | [ ] |
| 6   | `showOnDetail: true`                 | demo-projects | `description`   | `/admin/demo-projects/{id}`      | Visible on detail page                                                               | [ ] |
| 7   | `showOnForm: false`                  | demo-projects | `createdAt`     | `/admin/demo-projects/{id}/edit` | Not present in edit form                                                             | [ ] |
| 8   | `required`                           | demo-projects | `name`          | `/admin/demo-projects/create`    | Submit empty form, see validation error                                              | [ ] |
| 9   | `rules` (Valibot)                    | —             | —               | —                                | _Not demoed — add Valibot schema to a field_                                         | [ ] |
| 10  | `readonly` (static)                  | —             | —               | —                                | _Not demoed — add `readonly: true` to a field_                                       | [ ] |
| 11  | `readonly` (dynamic fn)              | —             | —               | —                                | _Not demoed — add `readonly: (ctx) => ...` to a field_                               | [ ] |
| 12  | `immutable`                          | —             | —               | —                                | _Not demoed — add `immutable: true` to a field (editable on create, locked on edit)_ | [ ] |
| 13  | `inlineEditable`                     | demo-projects | `ownerEmail`    | `/admin/demo-projects`           | Click cell in table to edit inline                                                   | [ ] |
| 14  | `inlineConfirmation`                 | —             | —               | —                                | _Not demoed — add `inlineConfirmation: true` to an inline-editable field_            | [ ] |
| 15  | `dependsOn` (value match)            | —             | —               | —                                | _Not demoed — add `dependsOn: { field, value }` to a field_                          | [ ] |
| 16  | `dependsOn` (predicate)              | —             | —               | —                                | _Not demoed — add `dependsOn: { field, predicate }` to a field_                      | [ ] |
| 17  | `resolveUsing`                       | —             | —               | —                                | _Not demoed — add `resolveUsing` callback to compute display value_                  | [ ] |
| 18  | `displayUsing`                       | —             | —               | —                                | _Not demoed — add `displayUsing` callback to format resolved value_                  | [ ] |
| 19  | `fillUsing`                          | —             | —               | —                                | _Not demoed — add `fillUsing` callback to transform on save_                         | [ ] |
| 20  | `renderOverride`                     | —             | —               | —                                | _Not demoed — add custom component for a specific context_                           | [ ] |
| 21  | `indexColumn` (preset)               | demo-projects | `budget`        | `/admin/demo-projects`           | Number column uses `number` preset sizing                                            | [ ] |
| 22  | `indexColumn` (fixed)                | demo-projects | `isFeatured`    | `/admin/demo-projects`           | Checkbox column stays fixed width on resize                                          | [ ] |
| 23  | `canSee` (field-level)               | demo-tasks    | `assigneeEmail` | `/admin/demo-tasks`              | Only visible when priority is 'high'                                                 | [ ] |
| 24  | `securityLevel`                      | —             | —               | —                                | _Not demoed — add `securityLevel: 'server'` to a field_                              | [ ] |
| 25  | `options` (select)                   | demo-projects | `status`        | `/admin/demo-projects/create`    | Dropdown shows draft/active/archived options                                         | [ ] |
| 26  | `defaultValue`                       | —             | —               | —                                | _Not demoed — add `defaultValue` to a field, verify form pre-fills_                  | [ ] |
| 27  | `helpTextKey`                        | —             | —               | —                                | _Not demoed — add help text below a form field_                                      | [ ] |
| 28  | `placeholderKey`                     | —             | —               | —                                | _Not demoed — add placeholder to a text input_                                       | [ ] |
| 29  | `ariaLabelKey`                       | —             | —               | —                                | _Not demoed — add custom aria-label_                                                 | [ ] |
| 30  | `slugFrom`                           | —             | —               | —                                | _Not demoed — auto-generate slug from another field_                                 | [ ] |
| 31  | `currencyCode` / `currencyLocale`    | —             | —               | —                                | _Not demoed — format currency display_                                               | [ ] |
| 32  | `statusMapping`                      | —             | —               | —                                | _Not demoed — map status values to colored badges_                                   | [ ] |
| 33  | `avatarFallback` / `avatarNameField` | —             | —               | —                                | _Not demoed — avatar with initials fallback_                                         | [ ] |
| 34  | `morphTo` config                     | demo-comments | `target`        | `/admin/demo-comments/create`    | Polymorphic type selector + entity picker                                            | [ ] |
| 35  | `relation` config                    | demo-tasks    | `projectId`     | `/admin/demo-tasks/create`       | Relation dropdown with value/label fields                                            | [ ] |

---

## 3. Filters

| #   | Filter Type                            | Demo Resource | URL Key        | URL                    | How to Test                                     | OK  |
| --- | -------------------------------------- | ------------- | -------------- | ---------------------- | ----------------------------------------------- | --- |
| 1   | `select` (explicit)                    | demo-comments | `targetKind`   | `/admin/demo-comments` | Select filter dropdown, verify table re-queries | [ ] |
| 2   | `boolean`                              | —             | —              | —                      | _Not demoed — add a boolean filter_             | [ ] |
| 3   | `date-range`                           | demo-comments | `createdRange` | `/admin/demo-comments` | Date range picker, verify filtered results      | [ ] |
| 4   | Auto-generated from `filterable: true` | demo-tasks    | `status`       | `/admin/demo-tasks`    | Filter auto-generated from field options        | [ ] |
| 5   | Clear all filters                      | demo-projects | —              | `/admin/demo-projects` | Click "Clear" button, all filters reset         | [ ] |

---

## 4. Actions

| #   | Feature                                 | Demo Resource | Action         | URL                      | How to Test                                                                          | OK  |
| --- | --------------------------------------- | ------------- | -------------- | ------------------------ | ------------------------------------------------------------------------------------ | --- |
| 1   | Basic action (with confirmation)        | demo-tasks    | `markDone`     | `/admin/demo-tasks`      | Select rows, click action, confirm dialog appears                                    | [ ] |
| 2   | `withoutConfirmation`                   | demo-comments | `markReviewed` | `/admin/demo-comments`   | Select rows, click action, executes immediately                                      | [ ] |
| 3   | `destructive` (defineDestructiveAction) | —             | —              | —                        | _Not demoed — add a destructive action (red button + confirm)_                       | [ ] |
| 4   | `standalone`                            | —             | —              | —                        | _Not demoed — add action that works without row selection_                           | [ ] |
| 5   | `sole`                                  | —             | —              | —                        | _Not demoed — add action that requires exactly 1 row selected_                       | [ ] |
| 6   | Action with `fields`                    | demo-projects | `attachTag`    | `/admin/demo-projects`   | Select rows, click action, form fields in modal                                      | [ ] |
| 7   | `showOnIndex`                           | demo-tasks    | `markDone`     | `/admin/demo-tasks`      | Action button visible in toolbar                                                     | [ ] |
| 8   | `showOnDetail`                          | demo-tasks    | `markDone`     | `/admin/demo-tasks/{id}` | Action button visible on detail page                                                 | [ ] |
| 9   | `showInline`                            | —             | —              | —                        | _Not demoed — add inline action button per row_                                      | [ ] |
| 10  | `canRun` (auth guard)                   | —             | —              | —                        | _Not demoed — add `canRun` that conditionally disables action_                       | [ ] |
| 11  | `chunkSize`                             | —             | —              | —                        | _Not demoed — add custom chunk size for batch processing_                            | [ ] |
| 12  | `icon` on action                        | —             | —              | —                        | _Not demoed — add icon to an action button_                                          | [ ] |
| 13  | Custom confirm text                     | —             | —              | —                        | _Not demoed — add `confirmTextKey` / `confirmButtonTextKey` / `cancelButtonTextKey`_ | [ ] |

---

## 5. Lenses

| #   | Feature                    | Demo Resource | Lens       | URL                                  | How to Test                                                | OK  |
| --- | -------------------------- | ------------- | ---------- | ------------------------------------ | ---------------------------------------------------------- | --- |
| 1   | Basic lens (filter preset) | demo-projects | `featured` | `/admin/demo-projects?lens=featured` | Select lens from dropdown, table filters to featured items | [ ] |
| 2   | Multiple lenses            | demo-projects | 3 lenses   | `/admin/demo-projects`               | Lens dropdown shows all/featured/archived/active           | [ ] |
| 3   | Lens with field overrides  | —             | —          | —                                    | _Not demoed — add `fields` to a LensDefinition_            | [ ] |
| 4   | Lens with filter overrides | —             | —          | —                                    | _Not demoed — add `filters` to a LensDefinition_           | [ ] |
| 5   | Lens with action overrides | —             | —          | —                                    | _Not demoed — add `actions` to a LensDefinition_           | [ ] |

---

## 6. Metrics

| #   | Metric Type                         | Demo Resource | Key                | URL                    | How to Test                                            | OK  |
| --- | ----------------------------------- | ------------- | ------------------ | ---------------------- | ------------------------------------------------------ | --- |
| 1   | `value`                             | demo-projects | `total`            | `/admin/demo-projects` | Card shows total count                                 | [ ] |
| 2   | `value` with `format: 'currency'`   | demo-projects | `budget`           | `/admin/demo-projects` | Card shows formatted currency value                    | [ ] |
| 3   | `trend`                             | demo-tasks    | `statusTrend`      | `/admin/demo-tasks`    | Card shows trend line chart                            | [ ] |
| 4   | `partition`                         | demo-tasks    | `prioritySplit`    | `/admin/demo-tasks`    | Card shows pie/donut chart                             | [ ] |
| 5   | `progress`                          | demo-tasks    | `completionRate`   | `/admin/demo-tasks`    | Card shows progress bar or radial                      | [ ] |
| 6   | `progress` with `display: 'radial'` | demo-tasks    | `completionRate`   | `/admin/demo-tasks`    | Radial arc chart instead of bar                        | [ ] |
| 7   | `progress` with `avoid: true`       | —             | —                  | —                      | _Not demoed — add inverted color logic metric_         | [ ] |
| 8   | `table`                             | demo-tasks    | `estimateByStatus` | `/admin/demo-tasks`    | Card shows tabular data                                | [ ] |
| 9   | `rangeOptions`                      | demo-projects | `total`            | `/admin/demo-projects` | Dropdown to switch metric range (without/with trashed) | [ ] |
| 10  | `format: 'percent'`                 | —             | —                  | —                      | _Not demoed — add a percent-formatted metric_          | [ ] |
| 11  | `icon` on metric                    | —             | —                  | —                      | _Not demoed — add icon to a metric card_               | [ ] |
| 12  | `descriptionKey`                    | —             | —                  | —                      | _Not demoed — add description text to a metric card_   | [ ] |
| 13  | `subtitleKey`                       | —             | —                  | —                      | _Not demoed — add subtitle to a metric card_           | [ ] |

---

## 7. Field Groups

| #   | Feature                | Demo Resource | URL                                                             | How to Test                                                   | OK  |
| --- | ---------------------- | ------------- | --------------------------------------------------------------- | ------------------------------------------------------------- | --- |
| 1   | Multiple groups (tabs) | demo-projects | `/admin/demo-projects/{id}`                                     | Detail page shows tabs (overview, content, relations, system) | [ ] |
| 2   | Context-scoped groups  | demo-projects | `/admin/demo-projects/{id}` vs `/admin/demo-projects/{id}/edit` | "system" group visible on detail but not form                 | [ ] |
| 3   | Preview groups         | demo-projects | `/admin/demo-projects/{id}`                                     | Preview card shows only overview group                        | [ ] |
| 4   | Single group (no tabs) | demo-tags     | `/admin/demo-tags/{id}`                                         | Detail page shows flat layout, no tabs                        | [ ] |

---

## 8. CRUD Operations

| #   | Feature                       | Demo Resource | URL                                 | How to Test                                                        | OK  |
| --- | ----------------------------- | ------------- | ----------------------------------- | ------------------------------------------------------------------ | --- |
| 1   | Create                        | demo-projects | `/admin/demo-projects/create`       | Fill form, submit, verify record appears in list                   | [ ] |
| 2   | Read (detail)                 | demo-projects | `/admin/demo-projects/{id}`         | All fields displayed with correct formatting                       | [ ] |
| 3   | Update (edit)                 | demo-projects | `/admin/demo-projects/{id}/edit`    | Modify fields, submit, verify changes persist                      | [ ] |
| 4   | Soft delete                   | demo-projects | `/admin/demo-projects`              | Delete via row action, record disappears from default view         | [ ] |
| 5   | Restore                       | demo-projects | `/admin/demo-projects?trashed=only` | Switch to trashed view, click restore                              | [ ] |
| 6   | Force delete                  | demo-projects | `/admin/demo-projects?trashed=only` | Switch to trashed view, click force delete                         | [ ] |
| 7   | Replicate                     | demo-projects | `/admin/demo-projects/{id}`         | Click replicate on detail, new record created                      | [ ] |
| 8   | Bulk delete                   | demo-projects | `/admin/demo-projects`              | Select multiple rows, click bulk delete                            | [ ] |
| 9   | Bulk restore                  | demo-projects | `/admin/demo-projects?trashed=only` | Select rows in trashed view, click bulk restore                    | [ ] |
| 10  | Bulk force delete             | demo-projects | `/admin/demo-projects?trashed=only` | Select rows in trashed view, click bulk force delete               | [ ] |
| 11  | Optimistic delete             | demo-projects | `/admin/demo-projects`              | Row disappears instantly before server confirms                    | [ ] |
| 12  | Optimistic restore            | demo-projects | `/admin/demo-projects?trashed=only` | Row disappears from trashed instantly                              | [ ] |
| 13  | Per-field conflict resolution | demo-projects | `/admin/demo-projects/{id}/edit`    | Open edit in 2 tabs, edit different fields, both save successfully | [ ] |

---

## 9. Table & Pagination

| #   | Feature                    | Demo Resource | URL                                              | How to Test                                         | OK  |
| --- | -------------------------- | ------------- | ------------------------------------------------ | --------------------------------------------------- | --- |
| 1   | Cursor-based pagination    | demo-projects | `/admin/demo-projects`                           | Navigate pages, verify correct data per page        | [ ] |
| 2   | Page size selector         | demo-projects | `/admin/demo-projects`                           | Change rows per page, table re-queries              | [ ] |
| 3   | Persisted page size        | demo-projects | `/admin/demo-projects`                           | Change page size, reload page, size persists        | [ ] |
| 4   | Search (debounced)         | demo-projects | `/admin/demo-projects`                           | Type in search, results filter after debounce       | [ ] |
| 5   | Sort (asc/desc/clear)      | demo-projects | `/admin/demo-projects`                           | Click sortable column header, cycles through states | [ ] |
| 6   | URL state sync             | demo-projects | `/admin/demo-projects?search=test&sort=name.asc` | Bookmark URL, reload, state restores from URL       | [ ] |
| 7   | Row click → detail         | demo-projects | `/admin/demo-projects`                           | Click a row, navigates to detail page               | [ ] |
| 8   | Row click → preview        | demo-tags     | `/admin/demo-tags`                               | Click a row, preview dialog opens                   | [ ] |
| 9   | Row selection (checkboxes) | demo-projects | `/admin/demo-projects`                           | Select rows, selection count updates                | [ ] |
| 10  | Loading skeleton           | demo-projects | `/admin/demo-projects`                           | Slow network or first load shows skeleton columns   | [ ] |
| 11  | Empty state                | —             | `/admin/demo-projects?search=zzzznotfound`       | Search for nonexistent term, see empty message      | [ ] |
| 12  | Last page navigation       | demo-projects | `/admin/demo-projects`                           | Click "last page" button, jumps to final page       | [ ] |
| 13  | Trashed filter             | demo-projects | `/admin/demo-projects`                           | Switch between without/with/only trashed            | [ ] |
| 14  | Column layout presets      | demo-projects | `/admin/demo-projects`                           | Number/checkbox columns use correct widths          | [ ] |

---

## 10. Export

| #   | Feature                             | Demo Resource | URL                    | How to Test                                                                | OK  |
| --- | ----------------------------------- | ------------- | ---------------------- | -------------------------------------------------------------------------- | --- |
| 1   | CSV export                          | demo-projects | `/admin/demo-projects` | Click CSV export, downloads .csv file                                      | [ ] |
| 2   | JSON export                         | demo-projects | `/admin/demo-projects` | Click JSON export, downloads .json file                                    | [ ] |
| 3   | Export respects `resolveFieldValue` | —             | —                      | _Verify export uses resolved values, not raw_                              | [ ] |
| 4   | CSV injection protection            | —             | —                      | _Add a record with `=SUM(A1)` in a text field, export CSV, verify escaped_ | [ ] |

---

## 11. Authorization

| #   | Feature                            | Demo Resource | URL                         | How to Test                                                  | OK  |
| --- | ---------------------------------- | ------------- | --------------------------- | ------------------------------------------------------------ | --- |
| 1   | `canCreate`                        | demo-projects | `/admin/demo-projects`      | Non-admin user: create button hidden                         | [ ] |
| 2   | `canUpdate`                        | demo-projects | `/admin/demo-projects/{id}` | Non-admin user: edit button hidden                           | [ ] |
| 3   | `canDelete`                        | demo-projects | `/admin/demo-projects/{id}` | Non-admin user: delete button hidden                         | [ ] |
| 4   | `canSee` (field-level)             | demo-tasks    | `/admin/demo-tasks`         | `assigneeEmail` only visible for high-priority tasks         | [ ] |
| 5   | `canSee` (resource-level)          | —             | —                           | _Not demoed — add `canSee` to hide entire resource from nav_ | [ ] |
| 6   | `_visibleFields` backend stripping | demo-tasks    | `/admin/demo-tasks`         | Inspect network: hidden field data not sent                  | [ ] |
| 7   | Runtime visible columns cache      | demo-tasks    | `/admin/demo-tasks`         | After first load, column visibility is cached                | [ ] |

---

## 12. Inline Editing

| #   | Feature              | Demo Resource | Field        | URL                    | How to Test                                               | OK  |
| --- | -------------------- | ------------- | ------------ | ---------------------- | --------------------------------------------------------- | --- |
| 1   | Inline text edit     | demo-tags     | `name`       | `/admin/demo-tags`     | Click cell, edit text, blur to save                       | [ ] |
| 2   | Inline select edit   | demo-tasks    | `status`     | `/admin/demo-tasks`    | Click cell, dropdown appears, select to save              | [ ] |
| 3   | Inline number edit   | demo-projects | `budget`     | `/admin/demo-projects` | Click cell, number input, blur to save                    | [ ] |
| 4   | Inline boolean edit  | demo-projects | `isFeatured` | `/admin/demo-projects` | Click checkbox directly in table                          | [ ] |
| 5   | Inline email edit    | demo-projects | `ownerEmail` | `/admin/demo-projects` | Click cell, email input, blur to save                     | [ ] |
| 6   | `inlineConfirmation` | —             | —            | —                      | _Not demoed — add confirmation dialog before inline save_ | [ ] |

---

## 13. Navigation & Sidebar

| #   | Feature                    | URL                              | How to Test                               | OK  |
| --- | -------------------------- | -------------------------------- | ----------------------------------------- | --- |
| 1   | Resource groups in sidebar | `/admin`                         | Resources grouped under group headings    | [ ] |
| 2   | Sidebar badge counts       | `/admin`                         | Live counts next to resource names        | [ ] |
| 3   | Active route highlighting  | `/admin/demo-projects`           | Current resource highlighted in sidebar   | [ ] |
| 4   | Breadcrumbs on detail      | `/admin/demo-projects/{id}`      | Breadcrumb shows resource > record title  | [ ] |
| 5   | Breadcrumbs on edit        | `/admin/demo-projects/{id}/edit` | Breadcrumb shows resource > record > edit | [ ] |

---

## 14. Preview Dialog

| #   | Feature                     | Demo Resource | URL                | How to Test                                         | OK  |
| --- | --------------------------- | ------------- | ------------------ | --------------------------------------------------- | --- |
| 1   | Preview on row click        | demo-tags     | `/admin/demo-tags` | Click row, preview dialog shows field subset        | [ ] |
| 2   | Preview → detail navigation | demo-tags     | `/admin/demo-tags` | Click "View" in preview dialog, navigates to detail | [ ] |

---

## 15. SSR Prefetch

| #   | Feature           | URL                         | How to Test                                        | OK  |
| --- | ----------------- | --------------------------- | -------------------------------------------------- | --- |
| 1   | SSR metric cards  | `/admin/demo-projects`      | View source: metric data in initial HTML           | [ ] |
| 2   | SSR detail record | `/admin/demo-projects/{id}` | View source: record data in initial HTML           | [ ] |
| 3   | Preload on hover  | `/admin/demo-projects`      | Hover over row, network tab shows prefetch request | [ ] |

---

## 16. Resource-Level Options

| #   | Option                         | Demo Resource | URL                         | How to Test                                    | OK  |
| --- | ------------------------------ | ------------- | --------------------------- | ---------------------------------------------- | --- |
| 1   | `softDeletes: true`            | demo-projects | `/admin/demo-projects`      | Trashed filter appears, delete is soft         | [ ] |
| 2   | `softDeletes: false` (default) | demo-tags     | `/admin/demo-tags`          | No trashed filter, delete is permanent         | [ ] |
| 3   | `clickAction: 'detail'`        | demo-projects | `/admin/demo-projects`      | Row click goes to detail page                  | [ ] |
| 4   | `clickAction: 'preview'`       | demo-tags     | `/admin/demo-tags`          | Row click opens preview dialog                 | [ ] |
| 5   | `clickAction: 'edit'`          | —             | —                           | _Not demoed — row click goes directly to edit_ | [ ] |
| 6   | `clickAction: 'select'`        | —             | —                           | _Not demoed — row click toggles selection_     | [ ] |
| 7   | `clickAction: 'ignore'`        | —             | —                           | _Not demoed — row click does nothing_          | [ ] |
| 8   | `subtitle`                     | demo-projects | `/admin/demo-projects/{id}` | Subtitle text below title on detail page       | [ ] |
| 9   | `badgeQuery`                   | demo-projects | `/admin`                    | Sidebar badge shows filtered count             | [ ] |
| 10  | `perPageOptions`               | demo-projects | `/admin/demo-projects`      | Page size dropdown shows [5, 10, 20, 50]       | [ ] |
| 11  | `tenantScoped`                 | —             | —                           | _Not demoed_                                   | [ ] |
| 12  | `search` array                 | demo-projects | `/admin/demo-projects`      | Search queries specified fields                | [ ] |
| 13  | `sortFields` array             | demo-projects | `/admin/demo-projects`      | Only specified fields show sort controls       | [ ] |

---

## 17. Miscellaneous

| #   | Feature                            | URL                               | How to Test                                    | OK  |
| --- | ---------------------------------- | --------------------------------- | ---------------------------------------------- | --- |
| 1   | i18n — all field labels translated | `/admin/demo-projects`            | Switch language, all labels update             | [ ] |
| 2   | i18n — filter labels translated    | `/admin/demo-projects`            | Switch language, filter dropdown labels update | [ ] |
| 3   | i18n — action labels translated    | `/admin/demo-tasks`               | Switch language, action button labels update   | [ ] |
| 4   | i18n — metric labels translated    | `/admin/demo-tasks`               | Switch language, metric card titles update     | [ ] |
| 5   | SEOHead on index page              | `/admin/demo-projects`            | Check `<title>` tag in page source             | [ ] |
| 6   | SEOHead on detail page             | `/admin/demo-projects/{id}`       | Check `<title>` tag in page source             | [ ] |
| 7   | Confirm delete dialog              | `/admin/demo-projects`            | Delete action shows confirmation dialog        | [ ] |
| 8   | Toast notifications                | `/admin/demo-projects`            | CRUD operations show success/error toasts      | [ ] |
| 9   | Error state on detail              | `/admin/demo-projects/invalid-id` | Error UI with back + retry buttons             | [ ] |
| 10  | Loading state on detail            | `/admin/demo-projects/{id}`       | Skeleton UI while loading                      | [ ] |

---

## Gap Summary — Features Not Yet Demoed

These features exist in `types.ts` / framework code but no demo resource uses them. They should be added to demo resources before the checklist can be fully completed.

### Field Types (11 missing)

- `url`, `badge`, `password`, `color`, `slug`, `currency`, `hidden`, `keyValue`, `booleanGroup`, `multiselect`, `heading`, `status`, `avatar`

### Field Options (15 missing)

- `rules`, `readonly` (static), `readonly` (dynamic), `immutable`, `inlineConfirmation`, `dependsOn` (value), `dependsOn` (predicate), `resolveUsing`, `displayUsing`, `fillUsing`, `renderOverride`, `securityLevel`, `defaultValue`, `helpTextKey`, `placeholderKey`, `ariaLabelKey`, `slugFrom`, `currencyCode`/`currencyLocale`, `statusMapping`, `avatarFallback`/`avatarNameField`

### Actions (6 missing)

- `destructive` (defineDestructiveAction), `standalone`, `sole`, `showInline`, `canRun`, `icon`, custom confirm text

### Metrics (4 missing)

- `avoid: true`, `format: 'percent'`, `icon`, `descriptionKey`, `subtitleKey`

### Lenses (3 missing)

- Field overrides, filter overrides, action overrides

### Resource Options (3 missing)

- `clickAction: 'edit'/'select'/'ignore'`, `tenantScoped`, `canSee` (resource-level)

### Filters (1 missing)

- `boolean` filter type
