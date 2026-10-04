import { redirect } from '@sveltejs/kit';
import { authPageURL } from '$lib/utils/url';
import { passkeyDestination } from '$lib/utils/passkey-nudge-policy';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
	const lang = params.lang ?? 'en';
	const destination = passkeyDestination(url.searchParams.get('redirectTo') ?? '', `/${lang}/app`);
	if (!locals.token) redirect(303, authPageURL(`/${lang}/signin`, destination));
	return { destination };
};
