# End-to-end test guidance

## What belongs here

Every step here is charged to the whole repository. The suite runs `workers: 1` because it shares one preview Convex backend and the admin specs mutate shared rows, `E2E Tests` is a required check on `main`, and against a CF preview each Playwright step pays a round trip: measured in the traces at roughly 2s to resolve a locator and 3s to dispatch a click. What the suite spends is steps, so a spec costs whatever its interactions cost, however few tests it declares.

- A test earns a place here when its failure needs a real browser **and** a deployed backend to appear at all: sign-up and sign-in, entitlement and payment, gates and redirects, prerender and preview-bypass paths, anything whose breakage would be silent in production.
- Whatever one layer can answer belongs to that layer. Component behaviour, CSS, copy, pure logic, and Convex function behaviour are cheaper and more precise as a unit test, a component test, or a lint rule.
- "A unit test cannot reach it" is on its own no reason to spend a browser on it. Weigh what the defect costs a user against two to three seconds on every future merge. A one-pixel offset in a press state loses that trade; a silent authorization hole wins it.
- Never assert sub-pixel geometry, computed styles read after a transition, or a row count that a later assertion then indexes. Each of those reads as a precise check and is really a race against layout, the animation clock, or a query that has not resolved yet.
- A spec that regularly spends more than half its budget gets an explicit `test.describe.configure({ timeout })` carrying the measured numbers. Raising the suite default instead hides the cost in every other spec.

## How to write them

- Run `bun run test:e2e` after every E2E change.
- Tests run against isolated deterministic ports and an isolated local Convex backend. Do not point them at a developer's cloud deployment.
- Use the seeded test/admin flows and helpers rather than introducing production bypasses.
- Prefer role, label, and visible-name selectors. Use kebab-case `data-testid` only when semantic selection is unstable.
- Keep tests deterministic: control time/data explicitly, avoid arbitrary sleeps, and assert the user-visible outcome.
- Clean up created data through the existing test helpers. Never set `AUTH_E2E_TEST_SECRET` in production.

When a user flow is a load-bearing contract, encode it here rather than describing the current sequence in documentation.
