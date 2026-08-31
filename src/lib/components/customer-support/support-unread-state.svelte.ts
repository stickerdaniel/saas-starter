import { useQuery } from 'convex-svelte';
import { api } from '$lib/convex/_generated/api';
import { isAnonymousUser } from '$lib/convex/utils/anonymousUser';
import { supportUserId } from './support-user-id.svelte.ts';

export function useSupportUnreadState() {
	const anonymousUserId = $derived(
		isAnonymousUser(supportUserId.current) ? (supportUserId.current ?? undefined) : undefined
	);
	const query = useQuery(api.support.readState.unreadAdminReplyCount, () => ({
		anonymousUserId
	}));

	return {
		get count(): number {
			return query.data ?? 0;
		},
		get hasUnread(): boolean {
			return (query.data ?? 0) > 0;
		}
	};
}
