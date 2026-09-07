<script module lang="ts">
	import type { ComponentProps } from 'svelte';
	import type ChatAttachments from '../ChatAttachments.svelte';

	export const capturedAttachments: {
		props?: ComponentProps<typeof ChatAttachments>;
	} = {};
</script>

<script lang="ts">
	let props: ComponentProps<typeof ChatAttachments> = $props();
	$effect(() => {
		capturedAttachments.props = props;
	});
</script>
