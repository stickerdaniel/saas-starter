import { redirect } from '@sveltejs/kit';
import { getLanguage } from '#lib/i18n/languages.js';
import type { RequestHandler } from './$types';

// The legal notice moved into the Contact page; this keeps old /impressum links working.
// An endpoint answers every Accept value, Markdown included, with the same redirect.
// The client router knows only pages and would match the catch-all 404 here, so in-app
// links target /contact#legal-notice directly.
export const GET: RequestHandler = ({ params }) => {
	redirect(308, `/${getLanguage(params.lang).code}/contact#legal-notice`);
};
