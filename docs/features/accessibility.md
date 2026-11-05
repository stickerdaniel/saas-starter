# Accessibility

The main public pages (home, sign-in, password reset, pricing, terms, and privacy) run automated axe-core checks against WCAG 2.1 AA rules in light and dark mode, with a few documented exceptions. Automated checks do not replace a manual audit. The template includes a skip-to-content link, semantic HTML throughout, and translated `aria-label` attributes. For visitors who ask for reduced motion, a lint rule requires sliding and flying transitions to respect `prefers-reduced-motion`, and a banned-pattern scan requires the `motion-safe:` prefix on spinners.

## Where to start in the code

- [`e2e/public-a11y.spec.ts`](../../e2e/public-a11y.spec.ts) and [`e2e/utils/axe-test.ts`](../../e2e/utils/axe-test.ts): the WCAG checks and their documented exceptions
- [`eslint/rules/`](../../eslint/rules/): accessibility and motion lint rules such as `no-hardcoded-aria-label` and `require-motion-guard-transition`
- [`src/AGENTS.md`](../../src/AGENTS.md): UI rules for localized accessibility copy and decorative controls
