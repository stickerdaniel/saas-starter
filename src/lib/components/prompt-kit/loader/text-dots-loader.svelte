<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		class?: string;
		text?: string;
		size?: 'sm' | 'md' | 'lg';
	}

	let { class: className, text = 'Thinking', size = 'md' }: Props = $props();

	const textSizes = {
		sm: 'text-xs',
		md: 'text-sm',
		lg: 'text-base'
	};
</script>

<div class={cn('inline-flex items-center', className)}>
	<span class={cn('font-medium text-primary', textSizes[size])}>
		{text}
	</span>
	<span class="inline-flex">
		<span class="animate-[loading-dots_1.4s_infinite_0.2s] text-primary">.</span>
		<span class="animate-[loading-dots_1.4s_infinite_0.4s] text-primary">.</span>
		<span class="animate-[loading-dots_1.4s_infinite_0.6s] text-primary">.</span>
	</span>
</div>
