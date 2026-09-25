<script lang="ts">
	import { cn } from '$lib/utils';
	import { AccordionContent } from '$lib/components/ui/accordion';
	import { Response, streamingTextAnimation } from '$lib/components/ai-elements/response';

	interface Props {
		class?: string;
		content: string;
		/** Only animate when actively streaming */
		isStreaming?: boolean;
		/** `muted` dims the reasoning so the answer stands out. */
		tone?: 'default' | 'muted';
	}

	let {
		class: className = '',
		content,
		isStreaming = false,
		tone = 'default',
		...props
	}: Props = $props();
</script>

<AccordionContent class={cn(tone === 'muted' && 'opacity-50', className)} {...props}>
	<Response {content} animation={streamingTextAnimation(isStreaming)} class="grid gap-2" />
</AccordionContent>
