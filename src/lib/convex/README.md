# Convex backend

Backend functions, schema, and auth config.

Before writing or reviewing any code in this directory, read the
`convex-guidelines` skill (`skills/convex-guidelines/SKILL.md`), it has the
canonical patterns for this project (validators, function registration,
pagination, indexes, Better Auth integration).

The frontend consumes these functions via `convex-svelte`
(`useQuery`), see "Rendering & Data Strategy" in `AGENTS.md`.

Convex docs: https://docs.convex.dev/functions
