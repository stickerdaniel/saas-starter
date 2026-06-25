<script lang="ts">
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import { cn } from '$lib/utils.js';

	let { class: className }: { class?: string } = $props();
</script>

<!-- Single source of truth for the support launcher glyph (mirrored). -->
<div class="-scale-x-100">
	<MessageSquareIcon class={cn('size-6 fill-current', className)} />
</div>
