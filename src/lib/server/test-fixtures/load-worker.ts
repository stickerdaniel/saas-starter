import type { ServerLoadEvent } from '@sveltejs/kit';
import { load } from '../../../routes/[[lang]]/app/community-chat/+page.server';

export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const event = {
			url,
			request,
			locals: { token: url.searchParams.get('token') ?? undefined },
			depends: () => {},
			parent: async () => ({}),
			cookies: { get: () => undefined }
		} as unknown as Parameters<typeof load>[0] & ServerLoadEvent;
		return Response.json(await load(event));
	}
};
