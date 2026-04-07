<script lang="ts">
	import { CopyButton } from '$lib/components/ui/copy-button';
	import type { BrandColor } from '$lib/brand/colors';

	interface Props {
		color: BrandColor;
	}

	let { color }: Props = $props();
</script>

<article
	class="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-background"
	data-testid="brand-color-swatch"
>
	<div class="aspect-[4/3] w-full" style="background-color: {color.hex}"></div>
	<div class="flex flex-1 flex-col gap-3 p-5">
		<div class="flex items-baseline justify-between gap-2">
			<h3 class="text-lg font-semibold">{color.name}</h3>
			<code class="text-xs text-muted-foreground">{color.token}</code>
		</div>
		<p class="text-sm leading-relaxed text-muted-foreground">{color.role}</p>
		<div class="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-3">
			<code class="text-sm">{color.hex}</code>
			<CopyButton text={color.hex} variant="ghost" size="icon" class="size-8" />
		</div>
		<div class="flex items-center justify-between gap-2">
			<code class="text-xs break-all text-muted-foreground">{color.oklch}</code>
			<CopyButton text={color.oklch} variant="ghost" size="icon" class="size-8" />
		</div>
	</div>
</article>
