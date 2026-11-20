# Convex backend

Backend helpers, shared validators, environment access and tests. The registered
functions, schema and auth config live in the Convex functions directory,
`src/lib/convex/`; the local Better Auth component lives in
`src/lib/convex-components/betterAuth/`. `AGENTS.md` in this directory describes the
split.

Before writing or reviewing backend code, read the `convex-guidelines` skill
(`.agents/skills/convex-guidelines/SKILL.md`), it has the canonical patterns for this
project (validators, function registration, pagination, indexes, Better Auth
integration).

The frontend consumes these functions via `convex-svelte`
(`useQuery`), see "Rendering choices" in `src/routes/AGENTS.md`.

Convex docs: https://docs.convex.dev/functions
