/**
 * Inert placeholder values injected into the local embedded Convex backend in
 * TEST mode (`bun run dev:test`).
 *
 * `convex.config.ts` declares these secrets required, so Convex rejects a fresh
 * test backend's push if they are absent. The e2e suite never exercises the
 * underlying services (Resend skips `@e2e.example.com` recipients, Autumn fails
 * open, OpenRouter is unused), so these dummies satisfy the push-time validation
 * with no real secret. Real values in `.env.convex.local` override them.
 *
 * Single source of truth: `vite.config.ts` spreads this when injecting the
 * backend env, and `scripts/env-schema-parity.test.ts` asserts that every
 * required var in `convex.config.ts` is covered here (or always provided), so a
 * newly added required secret can't silently break fresh-worktree e2e.
 */
export const TEST_ONLY_ENV_PLACEHOLDERS = {
	RESEND_API_KEY: 're_local_e2e_dummy',
	AUTH_EMAIL: 'noreply@e2e.example.com',
	EMAIL_ASSET_URL: 'http://localhost',
	AUTUMN_SECRET_KEY: 'am_sk_local_e2e_dummy',
	OPENROUTER_API_KEY: 'sk-or-local-e2e-dummy'
} as const;
