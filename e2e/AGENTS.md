# End-to-end test guidance

- Run `bun run test:e2e` after every E2E change.
- Tests run against isolated deterministic ports and an isolated local Convex backend. Do not point them at a developer's cloud deployment.
- Use the seeded test/admin flows and helpers rather than introducing production bypasses.
- Prefer role, label, and visible-name selectors. Use kebab-case `data-testid` only when semantic selection is unstable.
- Keep tests deterministic: control time/data explicitly, avoid arbitrary sleeps, and assert the user-visible outcome.
- Clean up created data through the existing test helpers. Never set `AUTH_E2E_TEST_SECRET` in production.

When a user flow is a load-bearing contract, encode it here rather than describing the current sequence in documentation.
