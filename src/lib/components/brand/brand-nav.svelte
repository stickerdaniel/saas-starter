<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { localizedHref } from '$lib/utils/i18n';
	import { cn } from '$lib/utils';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	interface NavItem {
		label: string;
		path:
			| '/brand'
			| '/brand/visual-identity'
			| '/brand/voice-and-tone'
			| '/brand/motion'
			| '/brand/resources';
	}

	const items: NavItem[] = [
		{ label: 'Brand Story', path: '/brand' },
		{ label: 'Visual Identity', path: '/brand/visual-identity' },
		{ label: 'Voice & Tone', path: '/brand/voice-and-tone' },
		{ label: 'Motion', path: '/brand/motion' },
		{ label: 'Resources', path: '/brand/resources' }
	];

	function stripLang(pathname: string): string {
		return pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
	}

	const currentPath = $derived(stripLang(page.url.pathname));
</script>

<nav aria-label={$t('aria.brand_nav')} data-testid="brand-nav">
	<!-- Desktop: sticky sidebar -->
	<div class="hidden lg:block">
		<ul class="space-y-1">
			{#each items as item (item.path)}
				{@const active = currentPath === item.path}
				<li>
					<a
						href={resolve(localizedHref(item.path))}
						class={cn(
							'block rounded-md px-3 py-2 text-sm transition-colors',
							active
								? 'bg-primary/10 text-primary font-medium'
								: 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
						)}
						aria-current={active ? 'page' : undefined}
					>
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</div>

	<!-- Mobile: horizontal scroll -->
	<div class="no-scrollbar -mx-4 overflow-x-auto px-4 lg:hidden">
		<ul class="flex min-w-max gap-2">
			{#each items as item (item.path)}
				{@const active = currentPath === item.path}
				<li>
					<a
						href={resolve(localizedHref(item.path))}
						class={cn(
							'inline-block rounded-full border px-4 py-2 text-sm whitespace-nowrap transition-colors',
							active
								? 'border-primary bg-primary/10 text-primary font-medium'
								: 'border-border/60 text-muted-foreground hover:text-foreground'
						)}
						aria-current={active ? 'page' : undefined}
					>
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</div>
</nav>
