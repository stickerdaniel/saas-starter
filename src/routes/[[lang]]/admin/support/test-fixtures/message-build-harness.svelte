<script lang="ts">
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import MessageBuild from '../message-build.svelte';

	let { build }: { build: string } = $props();
</script>

<!-- The app root provides the tooltip context the footer uses. -->
<Tooltip.Provider>
	<MessageBuild {build} />
</Tooltip.Provider>
