import { localizedHref } from '$lib/utils/i18n';
import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
import BotMessageSquareIcon from '@lucide/svelte/icons/bot-message-square';
import ServerCogIcon from '@lucide/svelte/icons/server-cog';
import Logo from '$lib/components/icons/logo.svelte';
import type { SidebarConfig, NavSubItem } from '../types';

interface PageState {
	pathname: string;
	search?: string;
	lang?: string;
}

interface AiChatThread {
	_id: string;
	lastMessage?: string;
	lastMessageAt?: number;
}

export function getAppSidebarConfig(
	pageState: PageState,
	userRole?: string,
	aiChatThreads?: AiChatThread[],
	warmThreadId?: string | null,
	newConversationLabel?: string,
	threadsHasMore?: boolean,
	onLoadMoreThreads?: () => void
): SidebarConfig {
	const { pathname, search, lang } = pageState;

	const activeThreadId = pathname.startsWith(`/${lang}/app/ai-chat`)
		? new URLSearchParams(search).get('thread')
		: null;

	const aiChatSubItems: NavSubItem[] = (aiChatThreads ?? []).map((thread) => ({
		id: thread._id,
		label: thread.lastMessage
			? thread.lastMessage.length > 30
				? thread.lastMessage.slice(0, 30) + '...'
				: thread.lastMessage
			: newConversationLabel || 'New conversation',
		url: localizedHref(`/app/ai-chat?thread=${thread._id}`),
		isActive: activeThreadId === thread._id,
		timestamp: thread.lastMessageAt
	}));

	// Point "AI Chat" to the pre-warmed thread when available
	const aiChatUrl = warmThreadId
		? localizedHref(`/app/ai-chat?thread=${warmThreadId}`)
		: localizedHref('/app/ai-chat');

	return {
		header: {
			icon: Logo,
			titleKey: 'app.name',
			href: localizedHref('/')
		},
		navItems: [
			{
				translationKey: 'app.sidebar.community_chat',
				url: localizedHref('/app/community-chat'),
				icon: MessagesSquareIcon,
				isActive: pathname === `/${lang}/app/community-chat`
			},
			{
				translationKey: 'app.sidebar.ai_chat',
				url: aiChatUrl,
				icon: BotMessageSquareIcon,
				isActive: pathname.startsWith(`/${lang}/app/ai-chat`),
				collapsible: true,
				subItems: aiChatSubItems,
				hasMore: threadsHasMore,
				onLoadMore: onLoadMoreThreads,
				// Disable nav when already on the warm thread (already "new chat")
				disableNav: !!activeThreadId && activeThreadId === warmThreadId
			}
		],
		footerLinks:
			userRole === 'admin'
				? [
						{
							translationKey: 'app.sidebar.admin_panel',
							url: localizedHref('/admin'),
							icon: ServerCogIcon,
							condition: true
						}
					]
				: []
	};
}
