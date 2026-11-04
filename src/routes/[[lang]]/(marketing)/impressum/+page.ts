import { redirect } from '@sveltejs/kit';
import { getLanguage } from '#lib/i18n/languages.js';
import type { PageLoad } from './$types';

// The legal notice moved into the Contact page; this keeps old /impressum links working.
// A universal load is a page route, so the redirect runs for document requests, whatever
// their Accept header, and for client navigation from links that still point here.
export const load: PageLoad = ({ params }) => {
	redirect(308, `/${getLanguage(params.lang).code}/contact#legal-notice`);
};
