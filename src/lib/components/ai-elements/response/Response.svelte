<script lang="ts">
	import { Streamdown, type StreamdownProps } from 'svelte-streamdown';
	import { cn } from '$lib/utils';
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
		shikiTheme={mode.current === 'dark' ? 'github-dark-default' : 'github-light-default'}
		baseTheme="shadcn"
		animation={presentedAnimation}
		{...restProps}
	/>
</div>
