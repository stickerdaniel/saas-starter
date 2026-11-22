# Convex backend

Backend helpers, shared validators, environment access, tests, and the registered
functions with their Confect groups. The Convex functions directory, `src/lib/convex/`,
holds the schema, the auth config, the HTTP router and the crons, and re-exports the
grouped functions at their published paths; the local Better Auth component lives in
`src/lib/convex-components/betterAuth/`. `AGENTS.md` in this directory describes the
split.

Before writing or reviewing backend code, read the `convex-guidelines` skill
(`.agents/skills/convex-guidelines/SKILL.md`), it has the canonical patterns for this
project (validators, function registration, pagination, indexes, Better Auth
integration).

The frontend consumes these functions via `convex-svelte`
(`useQuery`), see "Rendering choices" in `src/routes/AGENTS.md`.

Convex docs: https://docs.convex.dev/functions
