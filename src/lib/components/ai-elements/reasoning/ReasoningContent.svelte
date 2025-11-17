<script lang="ts">
	import { cn } from '$lib/utils';
	import { AccordionContent } from '$lib/components/ui/accordion';
	import { Response } from '$lib/components/ai-elements/response';
	import { getReasoningContext } from './reasoning-context.svelte';

	interface Props {
		class?: string;
		content: string;
	}

	let { class: className = '', content, ...props }: Props = $props();

	let reasoningContext = getReasoningContext();
	let animationKey = $state(0);
	let previousOpen = $state(reasoningContext.isOpen);

	// Watch for accordion opening and retrigger animation
	$effect(() => {
		let currentOpen = reasoningContext.isOpen;

		// Detect transition from closed -> open
		if (!previousOpen && currentOpen) {
			// Delay key increment until accordion is visibly opening
			setTimeout(() => {
				animationKey++;
			}, 100);
		}

		previousOpen = currentOpen;
	});
</script>

<AccordionContent class={cn('text-sm outline-none', className)} {...props}>
	{#key animationKey}
		<Response {content} animation={{ enabled: true }} class="grid gap-2" />
	{/key}
</AccordionContent>
