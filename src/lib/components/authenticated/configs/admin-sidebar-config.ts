import { localizedHref } from '$lib/utils/i18n';
import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
import UsersIcon from '@lucide/svelte/icons/users';
import ServerCogIcon from '@lucide/svelte/icons/server-cog';
import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
import HomeIcon from '@lucide/svelte/icons/home';
import AppWindowIcon from '@lucide/svelte/icons/app-window';
import type { SidebarConfig } from '../types';

interface PageState {
	pathname: string;
	lang?: string;
}

export function getAdminSidebarConfig(pageState: PageState): SidebarConfig {
	const { pathname, lang } = pageState;

	return {
		header: {
			icon: ServerCogIcon,
			titleKey: 'admin.title',
			href: localizedHref('/admin'),
			dropdownItems: [
				{
					translationKey: 'admin.navigation.home',
					url: localizedHref('/'),
					icon: HomeIcon
				},
				{
					translationKey: 'admin.navigation.app',
					url: localizedHref('/app'),
					icon: AppWindowIcon
				}
			]
		},
		navItems: [
			{
				translationKey: 'admin.sidebar.dashboard',
				url: localizedHref('/admin/dashboard'),
				icon: LayoutDashboardIcon,
				isActive: pathname.startsWith(`/${lang}/admin/dashboard`)
			},
			{
				translationKey: 'admin.sidebar.users',
				url: localizedHref('/admin/users'),
				icon: UsersIcon,
				isActive: pathname.startsWith(`/${lang}/admin/users`)
			}
		],
		footerLinks: [
			{
				translationKey: 'admin.sidebar.back_to_app',
				url: localizedHref('/app'),
				icon: ArrowLeftIcon,
				condition: true
			}
		]
	};
}
