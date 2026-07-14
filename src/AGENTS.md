# Application code guidance

This scope covers SvelteKit application code under `src/`. Backend-specific rules in `src/lib/convex/AGENTS.md` and route-specific rules in `src/routes/AGENTS.md` take precedence in their directories.

## Stack and structure

- SvelteKit, Svelte 5 runes, Tailwind CSS v4, shadcn-svelte
- Convex backend and realtime client
- Better Auth through the local Convex component install
- Tolgee with URL-based locales

Use existing structure: reusable UI in `src/lib/components`, routes under `src/routes/[[lang]]`, translations in `src/i18n`, shared i18n logic in `src/lib/i18n`, and server hooks in `src/hooks.server.ts`.

## Svelte and UI

Load the `svelte-core-bestpractices` skill before writing or reviewing Svelte modules or components.

- Use Svelte 5 runes and current event syntax.
- Prefer shadcn-svelte, then registered component resources, before creating a component.
- Use project theme tokens when importing external blocks.
- Prefer global Tailwind utilities for shared patterns over repeated component-local styles.
- Shadowed surfaces use a translucent `ring-1 ring-foreground/10`; avoid muddy solid borders beside shadows.
- Use `cmdOrCtrl` / `optionOrAlt` for platform-specific shortcut labels.
- Localize all user-facing and accessibility strings. Never hardcode English `aria-label` or `.sr-only` copy.
- Decorative non-functional controls must be removed from the accessibility tree.
- Use keyed `{#each}` blocks with stable identities.

General animation craft lives in the `emil-design-eng` skill. Prefer CSS for simple motion, honor reduced-motion preferences, and avoid adding animation without a clear interaction purpose.

## Internationalization

- Pull Tolgee before editing `src/i18n/*.json`: `bun run i18n:pull`.
- Add every new key to all supported locale files with idiomatic translations.
- Push after locale edits: `bun run i18n:push -- --tag-new-keys draft` (or the appropriate tag).
- Run `bun run i18n:cleanup` when intentionally removing production keys.
- Key names use nested objects, never literal dots in leaf names.
- The locale registry in `src/lib/i18n/languages.ts` is canonical; run `bun run i18n:sync` after adding or removing a locale.

## Environment access

Use `$env/static/public` for `PUBLIC_*` variables. Use `$env/dynamic/private` only for genuinely runtime-provided server secrets. Never access private environment values from client code.

## SEO and public markdown

Every new page includes `SEOHead`. Localized pages use translated `meta.*` title and description keys in every locale. Titles contain only the page name; `SEOHead` appends the configured brand.

Public marketing pages may serve agent-facing markdown from the same URL through `Accept: text/markdown`. Put the source in sibling `page.md.ts`, keep it aligned with the human page, and preserve any contact-address obfuscation. `/llms.txt` remains the discovery entrypoint.

## Testing hooks

Use accessible roles and labels first. Add `data-testid` only when semantic selection is not stable; use lowercase kebab-case and describe the element or action rather than visual placement.
