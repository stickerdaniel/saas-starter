import { localizedHref } from '$lib/utils/i18n';
import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
import UsersIcon from '@lucide/svelte/icons/users';
import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
import SettingsIcon from '@lucide/svelte/icons/settings';
import ServerCogIcon from '@lucide/svelte/icons/server-cog';
import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
import HomeIcon from '@lucide/svelte/icons/home';
import AppWindowIcon from '@lucide/svelte/icons/app-window';
import { getResourceGroups } from '$lib/admin/resource-groups';
import { getViewerUser, isResourceVisible } from '$lib/admin/visibility';
import type { SidebarConfig } from '../types';

interface PageState {
	pathname: string;
	lang?: string;
	supportBadge?: number;
	resourceBadges?: Record<string, number | undefined>;
	viewer?: unknown;
}

export function getAdminSidebarConfig(pageState: PageState): SidebarConfig {
	const { pathname, lang, supportBadge, resourceBadges = {} } = pageState;
	const viewer = getViewerUser(pageState.viewer);
	const fixedAdminNavItems = [
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
		},
		{
			translationKey: 'admin.sidebar.support',
			url: localizedHref('/admin/support'),
			icon: MessagesSquareIcon,
			isActive: pathname.startsWith(`/${lang}/admin/support`),
			badge: supportBadge
		},
		{
			translationKey: 'admin.sidebar.settings',
			url: localizedHref('/admin/settings'),
			icon: SettingsIcon,
			isActive: pathname.startsWith(`/${lang}/admin/settings`)
		}
	];

	const resourceGroups = getResourceGroups()
		.map((group) => ({
			labelKey: group.groupKey,
			navItems: group.resources
				.filter((resource) => isResourceVisible(resource, viewer))
				.map((resource) => ({
					translationKey: resource.navTitleKey,
					url: localizedHref(`/admin/${resource.name}`),
					icon: resource.icon,
					isActive: pathname.startsWith(`/${lang}/admin/${resource.name}`),
					badge: resourceBadges[resource.name]
				}))
		}))
		.filter((group) => group.navItems.length > 0);

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
		navGroups: [{ navItems: fixedAdminNavItems }, ...resourceGroups],
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
