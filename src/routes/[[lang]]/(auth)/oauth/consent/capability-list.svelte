<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { capabilityKey, type Capability } from '#lib/mcp/capabilities.js';

	let { capabilities, labelledby }: { capabilities: Capability[]; labelledby: string } = $props();
</script>

<ul
	aria-labelledby={labelledby}
	class="flex list-disc flex-col gap-1.5 pl-4 text-sm leading-snug font-normal text-muted-foreground"
>
	{#each capabilities as capability (capability.tool)}
		<li><T keyName={capabilityKey(capability)} /></li>
	{/each}
</ul>
