/**
 * API endpoint to render email templates
 *
 * This endpoint is called during build to pre-render email templates.
 * It uses the same renderer and infrastructure as the email preview UI.
 *
 * POST /api/emails/build
 * Body: { templates: [{ name: string, props: object }] }
 * Response: { templates: [{ name: string, html: string, text: string }] }
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { renderer } from '$lib/emails/renderer';
import { getEmailComponent } from 'better-svelte-email/preview';
import { toPlainText } from 'better-svelte-email/render';
import { getTemplatesForRendering } from '$lib/emails/templates/registry';

const TEMPLATES_PATH = '/src/lib/emails/templates';

/**
 * Convert __ETA_xxx__ markers to {{xxx}} template syntax
 * Also converts __BASEURL__ to {{baseUrl}}
 */
function convertMarkersToTemplate(html: string): string {
	return html.replace(/__ETA_(\w+)__/g, '{{$1}}').replace(/__BASEURL__/g, '{{baseUrl}}');
}

export const GET: RequestHandler = async () => {
	// Return the list of available templates and their placeholder configs
	return json({
		templates: getTemplatesForRendering()
	});
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { templates: requestedTemplates } = await request.json();

		// If no specific templates requested, render all
		const templatesToRender =
			requestedTemplates && Array.isArray(requestedTemplates)
				? requestedTemplates
				: getTemplatesForRendering();

		const results = [];

		for (const { name, props } of templatesToRender) {
			try {
				// Get the template component (don't add .svelte - getEmailComponent does that)
				const component = await getEmailComponent(TEMPLATES_PATH, name);

				// Render with marker props
				const rawHtml = await renderer.render(component, { props });
				const rawText = toPlainText(rawHtml);

				// Convert markers to template syntax
				const html = convertMarkersToTemplate(rawHtml);
				const text = convertMarkersToTemplate(rawText);

				results.push({
					name,
					html,
					text,
					success: true
				});
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
