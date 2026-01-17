import { localizedHref } from '$lib/utils/i18n';
import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
import BookOpenIcon from '@lucide/svelte/icons/book-open';
import HomeIcon from '@lucide/svelte/icons/home';
import ServerCogIcon from '@lucide/svelte/icons/server-cog';
import Logo from '$lib/components/icons/logo.svelte';
import type { SidebarConfig } from '../types';

interface PageState {
	pathname: string;
	lang?: string;
}

export function getAppSidebarConfig(pageState: PageState, userRole?: string): SidebarConfig {
	const { pathname, lang } = pageState;

	return {
		header: {
			icon: Logo,
			titleKey: 'app.name',
			href: localizedHref('/')
		},
		navItems: [
			{
				translationKey: 'app.sidebar.dashboard',
				url: localizedHref('/app/dashboard'),
				icon: LayoutDashboardIcon,
				isActive: pathname === `/${lang}/app/dashboard`
			},
			{
				translationKey: 'app.sidebar.community_chat',
				url: localizedHref('/app/community-chat'),
				icon: MessageCircleIcon,
				isActive: pathname === `/${lang}/app/community-chat`
			},
			{
				translationKey: 'app.sidebar.docs',
				url: 'https://docs.convex.dev',
				icon: BookOpenIcon,
				isActive: false
			},
			{
				translationKey: 'app.sidebar.home',
				url: localizedHref('/'),
				icon: HomeIcon,
				isActive: false
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
