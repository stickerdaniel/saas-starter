<script lang="ts">
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import { getTranslate } from '@tolgee/svelte';
	import { toggleMode } from 'mode-watcher';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { LightSwitchProps } from './types';

	const { t } = getTranslate();

	let { variant = 'outline' }: LightSwitchProps = $props();

	function handleToggle(event: MouseEvent) {
		haptic.trigger('medium');
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		document.documentElement.style.setProperty('--view-transition-x', `${x}px`);
		document.documentElement.style.setProperty('--view-transition-y', `${y}px`);

		if (!document.startViewTransition) {
			toggleMode();
			return;
		}

		document.startViewTransition(() => {
			toggleMode();
		});
	}
</script>

<Button onclick={handleToggle} {variant} size="icon">
	<SunIcon class="scale-100 rotate-0 !transition-all dark:scale-0 dark:-rotate-90" />
	<MoonIcon class="absolute scale-0 rotate-90 !transition-all dark:scale-100 dark:rotate-0" />
	<span class="sr-only">{$t('aria.toggle_theme')}</span>
</Button>
