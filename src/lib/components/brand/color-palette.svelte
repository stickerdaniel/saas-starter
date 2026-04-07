<script lang="ts">
	import { BRAND_COLORS } from '$lib/brand/colors';
	import ColorSwatch from './color-swatch.svelte';
</script>

<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="brand-color-palette">
	{#each BRAND_COLORS as color (color.token)}
		<ColorSwatch {color} />
	{/each}
</div>
