<script lang="ts">
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import { getTranslate } from '@tolgee/svelte';
	import { toggleMode } from 'mode-watcher';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
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

		if (!document.startViewTransition) {
			toggleMode();
			return;
		}

		// Mark the root so layout.css scopes the circular reveal to the theme
		// toggle instead of the page-navigation fade. The mark is a per-transition
		// token: an older transition must not clear the marker of a newer toggle.
		// `randomUUID` is absent outside a secure context, hence the fallback.
		const mark =
			typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random()}`;
		document.documentElement.setAttribute('data-theme-transition', mark);
		const transition = document.startViewTransition(() => {
			toggleMode();
		});
		const clearTransitionMark = () => {
			if (document.documentElement.getAttribute('data-theme-transition') === mark) {
				document.documentElement.removeAttribute('data-theme-transition');
			}
		};
		transition.ready.then(() => {
			// Write the viewport pixels only once the view-transition pseudo-elements
			// exist, so a high-DPI snapshot resolves these coordinates against the
			// captured layout instead of the pre-snapshot one.
			document.documentElement.style.setProperty('--view-transition-x', `${x}px`);
			document.documentElement.style.setProperty('--view-transition-y', `${y}px`);
		}, clearTransitionMark);
		transition.finished.then(clearTransitionMark, clearTransitionMark);
	}
</script>

<Button onclick={handleToggle} {variant} size="icon">
	<SunIcon class="scale-100 rotate-0 !transition-all dark:scale-0 dark:-rotate-90" />
	<MoonIcon class="absolute scale-0 rotate-90 !transition-all dark:scale-100 dark:rotate-0" />
	<span class="sr-only">{$t('aria.toggle_theme')}</span>
</Button>
