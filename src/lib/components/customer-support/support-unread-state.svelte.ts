import { useQuery } from 'convex-svelte';
import { api } from '$lib/convex/_generated/api';
import { isAnonymousUser } from '$lib/convex/utils/anonymousUser';
import { supportUserId } from './support-user-id.svelte.ts';

export function useSupportUnreadState() {
	const anonymousUserId = $derived(
		isAnonymousUser(supportUserId.current) ? (supportUserId.current ?? undefined) : undefined
	);
	const query = useQuery(api.support.readState.hasUnreadAdminReply, () => ({
		anonymousUserId
	}));

	return {
		get hasUnread(): boolean {
			return query.data === true;
		}
	};
}
