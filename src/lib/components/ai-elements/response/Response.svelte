<script lang="ts">
	import { Streamdown, type StreamdownProps } from 'svelte-streamdown';
	import { cn } from '#lib/utils.js';
	import { mode } from 'mode-watcher';
	import { paceStreamingText } from './streaming-pace.svelte.ts';

	type Props = StreamdownProps & {
		class?: string;
	};

	let { class: className, animation, ...restProps }: Props = $props();
	let presentationHeld = $state(false);
	const presentationActive = $derived(animation?.enabled === true || presentationHeld);
	const presentedAnimation = $derived(
		presentationActive ? { ...animation, enabled: true, animateOnMount: true } : animation
	);
	const streamingPace = paceStreamingText(
		() => animation?.enabled === true,
		(active) => (presentationHeld = active)
	);
</script>

<div class="contents" {@attach streamingPace}>
	<Streamdown
		class={cn('t-stream size-full [&_>_*:first-child]:mt-0 [&_>_*:last-child]:mb-0', className)}
		highlightTheme={mode.current === 'dark' ? 'github-dark' : 'github-light'}
		baseTheme="shadcn"
		controls={{ table: { fullscreen: false } }}
		animation={presentedAnimation}
		{...restProps}
	/>
</div>
