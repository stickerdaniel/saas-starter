export type SearchAccess = 'public' | 'authenticated' | 'admin';

export type SearchRouteGroup = 'public' | 'authentication' | 'app' | 'admin';

export interface SearchRouteEntry {
	href: string;
	access: SearchAccess;
	group: SearchRouteGroup;
	titleKey?: string;
	keywords?: string[];
}

export const SEARCH_ROUTES: SearchRouteEntry[] = [
	{
		href: '/',
		access: 'public',
		group: 'public',
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
		titleKey: 'nav.about',
		keywords: ['about', 'team']
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
		href: '/app/community-chat',
		access: 'authenticated',
		group: 'app',
		titleKey: 'app.sidebar.community_chat',
		keywords: ['chat', 'community']
	},
	{
		href: '/app/ai-chat',
		access: 'authenticated',
		group: 'app',
		titleKey: 'app.sidebar.ai_chat',
		keywords: ['ai', 'chat', 'assistant', 'bot']
	},
	{
		href: '/app/settings',
		access: 'authenticated',
		group: 'app',
		titleKey: 'settings.title',
		keywords: ['settings', 'account']
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
	},
	// Brand pages are public (prerendered, in PUBLIC_MARKETING_ROUTES, indexed by
	// llms.txt and sitemap) but intentionally NOT advertised in the cmd-k palette
	// to non-admin users. They are internal design docs that happen to be
	// reachable by URL. Direct visits work for everyone; discovery is admin-only.
	{
		href: '/brand',
		access: 'admin',
		group: 'admin',
		titleKey: 'meta.brand.title',
		keywords: ['brand', 'cadenza', 'identity', 'story']
	},
	{
		href: '/brand/visual-identity',
		access: 'admin',
		group: 'admin',
		titleKey: 'meta.brand_visual_identity.title',
		keywords: ['brand', 'visual identity', 'logo', 'color', 'typography']
	},
	{
		href: '/brand/voice-and-tone',
		access: 'admin',
		group: 'admin',
		titleKey: 'meta.brand_voice_and_tone.title',
		keywords: ['brand', 'voice', 'tone', 'copy', 'writing']
	},
	{
		href: '/brand/motion',
		access: 'admin',
		group: 'admin',
		titleKey: 'meta.brand_motion.title',
		keywords: ['brand', 'motion', 'animation', 'shader']
	},
	{
		href: '/brand/resources',
		access: 'admin',
		group: 'admin',
		titleKey: 'meta.brand_resources.title',
		keywords: ['brand', 'resources', 'download', 'tokens']
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
