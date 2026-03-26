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
}

export function getAppSidebarConfig(
	pageState: PageState,
	userRole?: string,
	aiChatThreads?: AiChatThread[]
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
			: 'New conversation',
		url: localizedHref(`/app/ai-chat?thread=${thread._id}`),
		isActive: activeThreadId === thread._id
	}));

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
				url: localizedHref('/app/ai-chat'),
				icon: BotMessageSquareIcon,
				isActive: pathname.startsWith(`/${lang}/app/ai-chat`),
				collapsible: true,
				subItems: aiChatSubItems,
				// Disable nav when on an empty thread (activeThreadId exists but not in sub-items list)
				disableNav: !!activeThreadId && !aiChatSubItems.some((s) => s.id === activeThreadId)
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
