# Form Builder Scaffolding

The JSON files in this directory (`change-email`, `change-password`, `forgot-password`, `login`, `reset-password`, `signup`) are historical UI-layout scaffolding produced by the Svelte Form Builder. They describe field layout only and are kept for reference. They are not live remote-form configs and nothing at runtime reads them.

All six cover Better Auth session-sensitive flows. The form decision tree in `AGENTS.md` routes those flows to the client-side `authClient` pattern and lists them as "Not recommended" for SvelteKit remote forms, so they stay on `authClient`.

The only production remote form is the admin add-email dialog: `addEmailForm` in `src/routes/[[lang]]/admin/settings/data.remote.ts`, built with SvelteKit `form()` plus Valibot validation and surfaced by `add-email-dialog.svelte`. It has no builder JSON in this directory.
