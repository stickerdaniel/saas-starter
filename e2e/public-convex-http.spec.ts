import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { z } from 'zod';
import { resolveConvexSiteUrl } from './utils/convex-url';
import { test } from './utils/test';

const RESPONSE_HEADERS = [
	'access-control-allow-headers',
	'access-control-allow-methods',
	'access-control-allow-origin',
	'cache-control',
	'content-type',
	'location'
];

const Probes = z.array(
	z.object({
		method: z.string(),
		path: z.string(),
		request: z
			.object({ headers: z.record(z.string(), z.string()).optional(), body: z.string().optional() })
			.optional(),
		status: z.array(z.number()),
		headers: z.record(z.string(), z.string()).optional()
	})
);

const probes = Probes.parse(
	JSON.parse(
		readFileSync(
			new URL('../src/lib/confect/__goldens__/http-responses.json', import.meta.url),
			'utf8'
		)
	)
);

function responseHeaders(headers: Record<string, string>, site: string): Record<string, string> {
	return Object.fromEntries(
		RESPONSE_HEADERS.flatMap((name) => {
			const value = headers[name];
			if (value === undefined) return [];
			if (name !== 'location') return [[name, value]];
			const location = new URL(value, site);
			return [[name, `${location.pathname}${location.search}`]];
		})
	);
}

test('the Convex HTTP routes answer requests without a secret as the goldens record', async ({
	request
}) => {
	const site = resolveConvexSiteUrl();
	if (!site) throw new Error('No Convex site URL: set PUBLIC_CONVEX_SITE_URL or run dev:test.');

	const answers = [];
	for (const probe of probes) {
		const response = await request.fetch(`${site}${probe.path}`, {
			method: probe.method,
			headers: probe.request?.headers,
			data: probe.request?.body,
			maxRedirects: 0,
			failOnStatusCode: false
		});
		const status = response.status();
		answers.push({
			...probe,
			status: probe.status.includes(status) ? probe.status : [status],
			...(probe.headers && { headers: responseHeaders(response.headers(), site) })
		});
	}

	expect(answers).toEqual(probes);
});
