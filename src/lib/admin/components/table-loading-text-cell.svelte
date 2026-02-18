<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	type Props = {
		widthClass?: string;
	};

	let { widthClass = 'w-24' }: Props = $props();
</script>

<Skeleton class={`h-4 ${widthClass}`} />
