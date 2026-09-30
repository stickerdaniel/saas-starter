import type { BeforeSendFn, PostHog } from 'posthog-js';

/**
 * The PostHog SDK options, in one place. Everything automatic is off: the app owns
 * pageviews and custom events (see controller.ts), so nothing reaches the SDK's
 * capture path without passing the consent and identity checks first.
 *
 * Turning a capability back on (autocapture, session replay, web vitals, feature
 * flags, email on identify) widens what is collected. Update the consent copy and
 * the privacy policy and bump the consent version when you do; see
 * docs/setup/analytics/posthog.md.
 */

export interface PosthogInstanceOptions {
	apiKey: string;
	apiHost: string;
	uiHost: string | undefined;
	/** `memory` when localStorage or sessionStorage is not durable in this browser. */
	persistence: 'localStorage' | 'memory';
	beforeSend: BeforeSendFn;
	name: string;
}

/** Query parameters the SDK masks in the URLs it stores; before_send drops the rest. */
const SECRET_QUERY_PARAMS = [
	'token',
	'code',
	'state',
	'callbackURL',
	'redirectTo',
	'error',
	'error_description',
	'email',
	'search',
	'q'
];

export async function loadPosthog(): Promise<PostHog> {
	return (await import('posthog-js')).default;
}

/** A named instance, so a stale default instance can never pick up this config. */
export function createPosthogInstance(
	posthog: PostHog,
	options: PosthogInstanceOptions
): PostHog | undefined {
	return posthog.init(
		options.apiKey,
		{
			api_host: options.apiHost,
			...(options.uiHost ? { ui_host: options.uiHost } : {}),
			persistence: options.persistence,
			person_profiles: 'identified_only',
			// The SDK captures nothing and stores nothing until the app opts it in right
			// after a live consent check, so a reset or a lost SDK marker fails closed.
			opt_out_capturing_by_default: true,
			opt_out_persistence_by_default: true,
			capture_pageview: false,
			capture_pageleave: false,
			autocapture: false,
			rageclick: false,
			capture_dead_clicks: false,
			capture_heatmaps: false,
			capture_performance: false,
			capture_exceptions: false,
			disable_session_recording: true,
			disable_surveys: true,
			disable_conversations: true,
			disable_product_tours: true,
			advanced_disable_flags: true,
			disable_external_dependency_loading: true,
			request_batching: false,
			disable_capture_url_hashes: true,
			mask_personal_data_properties: true,
			custom_personal_data_properties: SECRET_QUERY_PARAMS,
			before_send: options.beforeSend
		},
		options.name
	);
}
