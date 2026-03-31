/**
 * API endpoint to render email templates (dev-only)
 *
 * This endpoint is called during build to pre-render email templates.
 * It uses the same renderer and infrastructure as the email preview UI.
 * Heavy deps (prettier, tailwindcss, postcss) are excluded from production
 * bundles via dynamic imports gated on import.meta.env.DEV.
 *
 * POST /api/emails/build
 * Body: { templates: [{ name: string, props: object }] }
 * Response: { templates: [{ name: string, html: string, text: string }] }
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const TEMPLATES_PATH = '/src/lib/emails/templates';

function convertMarkersToTemplate(html: string): string {
	return html.replace(/__ETA_(\w+)__/g, '{{$1}}').replace(/__BASEURL__/g, '{{baseUrl}}');
}

export const GET: RequestHandler = async () => {
	if (!import.meta.env.DEV) return error(404, 'Not available in production');

	const { getTemplatesForRendering } = await import('$lib/emails/templates/registry');
	return json({ templates: getTemplatesForRendering() });
};

export const POST: RequestHandler = async ({ request }) => {
	if (!import.meta.env.DEV) return error(404, 'Not available in production');

	const { renderer } = await import('$lib/emails/renderer');
	const { getEmailComponent } = await import('better-svelte-email/preview');
	const { toPlainText } = await import('better-svelte-email/render');
	const { getTemplatesForRendering } = await import('$lib/emails/templates/registry');

	try {
		const { templates: requestedTemplates } = await request.json();

		const templatesToRender =
			requestedTemplates && Array.isArray(requestedTemplates)
				? requestedTemplates
				: getTemplatesForRendering();

		const results = [];

		for (const { name, props } of templatesToRender) {
			try {
				const component = await getEmailComponent(TEMPLATES_PATH, name);
				const rawHtml = await renderer.render(component, { props });
				const rawText = toPlainText(rawHtml);
				const html = convertMarkersToTemplate(rawHtml);
				const text = convertMarkersToTemplate(rawText);

				results.push({ name, html, text, success: true });
			} catch (err) {
				results.push({
					name,
					error: err instanceof Error ? err.message : String(err),
					success: false
				});
			}
		}

		return json({ templates: results });
	} catch (err) {
		throw error(400, err instanceof Error ? err.message : 'Invalid request');
	}
};
