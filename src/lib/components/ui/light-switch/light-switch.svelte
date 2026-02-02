<script lang="ts">
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import { toggleMode } from 'mode-watcher';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { LightSwitchProps } from './types';

	let { variant = 'outline' }: LightSwitchProps = $props();

	function handleToggle(event: MouseEvent) {
		// Get click position for reveal origin
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;

		// Fallback for unsupported browsers
		if (!document.startViewTransition) {
			toggleMode();
			return;
		}

		const transition = document.startViewTransition(toggleMode);

		// Set reveal origin when transition is ready
		transition.ready.then(() => {
			document.documentElement.style.setProperty('--view-transition-x', `${x}px`);
			document.documentElement.style.setProperty('--view-transition-y', `${y}px`);
		});
	}
</script>

<Button onclick={handleToggle} {variant} size="icon">
	<SunIcon class="scale-100 rotate-0 !transition-all dark:scale-0 dark:-rotate-90" />
	<MoonIcon class="absolute scale-0 rotate-90 !transition-all dark:scale-100 dark:rotate-0" />
	<span class="sr-only">Toggle theme</span>
</Button>
