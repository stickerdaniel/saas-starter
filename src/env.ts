import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * The variables SvelteKit exposes through `$app/env/public` and `$app/env/private`.
 * Varlock (`.env.schema`) stays the source of validation, defaults and sensitivity;
 * this registry only names what SvelteKit modules read, so it carries no values.
 *
 * Public variables are static: they are inlined at build time, so an empty value still
 * dead-code-eliminates its feature. `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL`
 * are read by `@mmailaender/convex-better-auth-svelte` through `$env/static/public`,
 * which SvelteKit 3 also serves from this registry.
 */
export const variables = defineEnvVars({
	PUBLIC_CONVEX_URL: { public: true, static: true },
	PUBLIC_CONVEX_SITE_URL: { public: true, static: true },
	PUBLIC_SITE_URL: { public: true, static: true },
	PUBLIC_SENTRY_DSN: { public: true, static: true },
	PUBLIC_POSTHOG_API_KEY: { public: true, static: true },
	PUBLIC_POSTHOG_HOST: { public: true, static: true },
	PUBLIC_POSTHOG_ALLOWED_HOSTS: { public: true, static: true },
	PUBLIC_SNAPDOM_PROXY_URL: { public: true, static: true },
	// Provided by the host at runtime on private Docker networks; unset everywhere else.
	CONVEX_INTERNAL_URL: { schema: (value) => value ?? '' }
});
