<script lang="ts">
	import { cn } from '$lib/utils';
	import { AccordionContent } from '$lib/components/ui/accordion';
	import { Response } from '$lib/components/ai-elements/response';

	interface Props {
		class?: string;
		content: string;
	}

	let { class: className = '', content, ...props }: Props = $props();
</script>

<AccordionContent class={cn('text-sm outline-none', className)} {...props}>
	<Response {content} animation={{ enabled: true }} class="grid gap-2" />
</AccordionContent>
