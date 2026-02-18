# Admin Framework Migration Guide

## Add a New Resource

### Automated (recommended)

Run the interactive generator:

```bash
bun run admin:generate:resource
```

This creates all required files and wiring automatically:

1. Frontend resource config + co-located runtime (`src/lib/admin/resources/<name>.ts`)
2. Backend Convex handlers with all 12 exports (`src/lib/convex/adminFramework/resources/<module>.ts`)
3. i18n keys in all locale files (`en`, `de`, `es`, `fr`)
4. Search index entry in `search_index.ts`
5. CRUD guard entry in `resource_guards.ts`

**After running the generator:**

1. Add the Convex table + indexes to `src/lib/convex/schema.ts`
2. Run `bun run generate` to build Convex types
3. Customize `CUSTOMIZE`-marked sections in both generated files
4. Fill in non-English translations
5. Run `bun scripts/static-checks.ts` on the generated files

The resource is **auto-discovered** via `import.meta.glob` in `registry.ts` — no manual registration step is needed.

### Manual

1. Add Convex table + indexes in `src/lib/convex/schema.ts`.
2. Add Convex endpoints under `src/lib/convex/adminFramework/resources/<resource>.ts`:
   - `list*`, `count*`, `resolve*LastPage`, `get*ById`
   - `create*`, `update*`, `delete*`, `restore*`, `forceDelete*`, `replicate*`
   - `run*Action`, `get*Metrics`
3. Add resource definition + co-located runtime in `src/lib/admin/resources/<resource>.ts` using `defineResourceModule({ resource, runtime })` as the default export.
4. Add Tolgee keys in all locale files (`en`, `de`, `es`, `fr`).
5. Add entry to `search_index.ts` and `resource_guards.ts`.
6. Add unit + E2E coverage for table state, CRUD, and actions.

Auto-discovery picks up the resource from the default export — no registry or runtime file edits needed.

## Convert Existing Custom Admin Pages Later

- Keep custom pages (`dashboard`, `users`, `support`, `settings`) as-is.
- Recreate feature logic as a resource module.
- Add resource-specific fields/actions/filters/lenses/metrics.
- Move route to `/admin/<resource>` and validate parity with current E2E coverage.

## Generator

### Interactive mode (for humans)

```bash
bun run admin:generate:resource
```

Prompts for: resource name, Convex table name, fields (name:type pairs), soft deletes, and sidebar group key.

### Non-interactive mode (for LLMs / CI)

```bash
bun scripts/admin/generate-resource.ts \
  --name blog-posts \
  --table blogPosts \
  --fields "title:text,status:select,published:boolean" \
  [--soft-deletes] \
  [--group admin.resources.groups.content]
```

All three flags (`--name`, `--table`, `--fields`) are required. `--soft-deletes` is a boolean flag. `--group` defaults to `admin.resources.groups.demo_data`.

Valid field types: `text`, `textarea`, `number`, `boolean`, `select`, `date`, `datetime`, `image`, `file`, `email`, `url`, `json`, `code`, `markdown`, `badge`.

## Validation

```bash
bun run admin:validate:search-indexes
```

Validates that every searchable resource has a matching search index config and schema declaration.
