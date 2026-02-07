export type SearchAccess = 'public' | 'authenticated' | 'admin';

export type SearchRouteGroup = 'public' | 'authentication' | 'app' | 'admin';

export interface SearchRouteEntry {
	href: string;
	access: SearchAccess;
	group: SearchRouteGroup;
	titleKey?: string;
	seoTitleKey?: string;
	keywords?: string[];
}

export const SEARCH_ROUTES: SearchRouteEntry[] = [
	{
		href: '/',
		access: 'public',
		group: 'public',
		seoTitleKey: 'meta.home.title',
		titleKey: 'nav.home',
		keywords: ['home', 'landing']
	},
	{
		href: '/pricing',
		access: 'public',
		group: 'public',
		titleKey: 'nav.pricing',
		keywords: ['pricing', 'plans', 'billing']
	},
	{
		href: '/about',
		access: 'public',
		group: 'public',
		seoTitleKey: 'meta.about.title',
		titleKey: 'nav.about',
		keywords: ['about', 'team']
	},
	{
		href: '/shadcn-demo',
		access: 'public',
		group: 'public',
		keywords: ['demo', 'shadcn']
	},
	{
		href: '/signin',
		access: 'public',
		group: 'authentication',
		titleKey: 'auth.signin.tab_signin',
		keywords: ['signin', 'login', 'auth']
	},
	{
		href: '/forgot-password',
		access: 'public',
		group: 'authentication',
		titleKey: 'auth.forgot_password.title',
		keywords: ['forgot password', 'reset']
	},
	{
		href: '/reset-password',
		access: 'public',
		group: 'authentication',
		titleKey: 'auth.reset_password.title',
		keywords: ['reset password', 'password']
	},
	{
		href: '/app',
		access: 'authenticated',
		group: 'app',
		titleKey: 'admin.navigation.app',
		keywords: ['app']
	},
	{
		href: '/app/dashboard',
		access: 'authenticated',
		group: 'app',
		titleKey: 'app.sidebar.dashboard',
		keywords: ['dashboard']
	},
	{
		href: '/app/community-chat',
		access: 'authenticated',
		group: 'app',
		titleKey: 'app.sidebar.community_chat',
		keywords: ['chat', 'community']
	},
	{
		href: '/app/settings',
		access: 'authenticated',
		group: 'app',
		titleKey: 'settings.title',
		keywords: ['settings', 'account']
	},
	{
		href: '/admin',
		access: 'admin',
		group: 'admin',
		titleKey: 'admin.title',
		keywords: ['admin']
	},
	{
		href: '/admin/dashboard',
		access: 'admin',
		group: 'admin',
		titleKey: 'admin.sidebar.dashboard',
		keywords: ['admin dashboard']
	},
	{
		href: '/admin/users',
		access: 'admin',
		group: 'admin',
		titleKey: 'admin.sidebar.users',
		keywords: ['users', 'admin users']
	},
	{
		href: '/admin/support',
		access: 'admin',
		group: 'admin',
		titleKey: 'admin.sidebar.support',
		keywords: ['support', 'tickets']
	},
	{
		href: '/admin/settings',
		access: 'admin',
		group: 'admin',
		titleKey: 'admin.sidebar.settings',
		keywords: ['admin settings']
	}
];

export function titleizeRouteFromHref(href: string): string {
	if (href === '/') return 'Home';

	const segments = href.split('/').filter(Boolean);
	const segment = segments[segments.length - 1] ?? href;

	return segment
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}
