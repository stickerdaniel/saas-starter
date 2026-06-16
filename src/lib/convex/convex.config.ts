import { defineApp } from 'convex/server';
import { v } from 'convex/values';
import betterAuth from './betterAuth/convex.config';
import resend from '@convex-dev/resend/convex.config';
import autumn from '@useautumn/convex/convex.config';
import agent from '@convex-dev/agent/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';
import convexFilesControl from '@gilhrpenner/convex-files-control/convex.config';

/**
 * Declared Convex backend environment variables.
 *
 * Convex validates these at push time (missing required vars or values that
 * fail their validator reject the deploy) and emits a typed `env` object into
 * `_generated/server`. This mirrors `.env-convex.schema`, which stays the
 * canonical superset: varlock still owns log redaction, leak scanning, the
 * `@type=url`/`@type=boolean` coercion, and the SvelteKit runtime side.
 *
 * Env values are always strings, so only string-like validators are allowed
 * (`v.string()`, string `v.literal()`/`v.union()`, and `v.optional()`).
 * `scripts/env-schema-parity.test.ts` keeps this block in sync with the schema.
 */
const app = defineApp({
	env: {
		// Required, string-like (deploy-time presence + value guard)
		BETTER_AUTH_SECRET: v.string(),
		SITE_URL: v.string(), // @type=url stays enforced by varlock
		RESEND_API_KEY: v.string(),
		AUTH_EMAIL: v.string(),
		EMAIL_ASSET_URL: v.string(), // @type=url stays enforced by varlock
		AUTUMN_SECRET_KEY: v.string(),
		OPENROUTER_API_KEY: v.string(),
		// Optional
		RESEND_WEBHOOK_SECRET: v.optional(v.string()),
		AUTH_GOOGLE_ID: v.optional(v.string()),
		AUTH_GOOGLE_SECRET: v.optional(v.string()),
		AUTH_GITHUB_ID: v.optional(v.string()),
		AUTH_GITHUB_SECRET: v.optional(v.string()),
		AUTH_E2E_TEST_SECRET: v.optional(v.string()),
		PREVIEW_ADMIN_PASSWORD: v.optional(v.string()),
		// @type=boolean cannot be expressed here; varlock keeps the boolean type,
		// runtime code compares the raw 'true' string.
		LOCAL_CONVEX_DEV: v.optional(v.string()),
		LOCAL_SEEDED_ADMIN_EMAIL: v.optional(v.string()),
		LOCAL_SEEDED_ADMIN_PASSWORD: v.optional(v.string()),
		LOCAL_SEEDED_ADMIN_NAME: v.optional(v.string())
	}
});
app.use(betterAuth);
app.use(resend);
app.use(autumn);
app.use(agent);
app.use(rateLimiter);
app.use(convexFilesControl);
/**
 * Convex application configured with Autumn billing, Resend email, and AI Agent.
 *
 * This configuration registers plugins with the Convex backend:
 * - Autumn: Subscription and usage tracking functionality
 * - Resend: Transactional email delivery
 * - Agent: AI-powered conversation and thread management
 */
export default app;
