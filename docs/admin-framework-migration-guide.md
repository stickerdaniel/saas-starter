# Admin Framework Migration Guide

## Add a New Resource

1. Add Convex table + indexes in `src/lib/convex/schema.ts`.
2. Add Convex endpoints under `src/lib/convex/adminFramework/resources/<resource>.ts`:
   - `list*`, `count*`, `resolve*LastPage`, `get*ById`
   - `create*`, `update*`, `delete*`, `restore*`, `forceDelete*`, `replicate*`
   - `run*Action`, `get*Metrics`
3. Add resource definition in `src/lib/admin/resources/<resource>.ts` using `labelKey`-based field/action/filter config.
4. Register resource in `src/lib/admin/registry.ts` and runtime endpoints in `src/lib/admin/runtime.ts`.
5. Add Tolgee keys in all locale files (`en`, `de`, `es`, `fr`).
6. Add unit + E2E coverage for table state, CRUD, and actions.

## Convert Existing Custom Admin Pages Later

- Keep custom pages (`dashboard`, `users`, `support`, `settings`) as-is.
- Recreate feature logic as a resource module.
- Add resource-specific fields/actions/filters/lenses/metrics.
- Move route to `/admin/<resource>` and validate parity with current E2E coverage.

## Generator Shortcuts

- `bun run admin:generate:resource <name>`
- `bun run admin:generate:field <attribute> <type>`
- `bun run admin:generate:filter <key>`
- `bun run admin:generate:action <key>`
- `bun run admin:generate:lens <key>`
- `bun run admin:generate:metric <key> <type>`
