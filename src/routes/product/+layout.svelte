<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import ProductSidebar from '$lib/components/product-sidebar.svelte';
	import ProductHeader from '$lib/components/product-header.svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		data: LayoutData;
	}

	let { children, data }: Props = $props();
</script>

{#if data.viewer}
	<Sidebar.Provider
		style="--sidebar-width: calc(var(--spacing) * 72); --header-height: calc(var(--spacing) * 12);"
	>
		<ProductSidebar
			variant="inset"
			user={{
				name: data.viewer.name ?? 'User',
				email: data.viewer.email ?? '',
				image: data.viewer.image
			}}
		/>
		<Sidebar.Inset>
			<ProductHeader />
			<div class="flex flex-1 flex-col overflow-hidden">
				{@render children?.()}
			</div>
		</Sidebar.Inset>
	</Sidebar.Provider>
{/if}
