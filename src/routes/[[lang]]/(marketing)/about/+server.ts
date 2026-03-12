import type { RequestHandler } from './$types';
import { DEFAULT_LANGUAGE } from '$lib/i18n/languages';
import {
	createMarketingMarkdownErrorResponse,
	createMarketingMarkdownResponse,
	createMarkdownNotAcceptableResponse,
	isMarkdownRequest
} from '$lib/markdown/marketing';
import { marketingMarkdown } from './page.md';

export const GET: RequestHandler = ({ request, url, params }) => {
	if (!isMarkdownRequest(request)) {
		return createMarkdownNotAcceptableResponse();
	}

	try {
		return createMarketingMarkdownResponse(marketingMarkdown, {
			origin: url.origin,
			pathname: url.pathname,
			lang: params.lang ?? DEFAULT_LANGUAGE
		});
	} catch (error) {
		console.error('[marketing markdown] failed to render about markdown', error);
		return createMarketingMarkdownErrorResponse();
	}
};
