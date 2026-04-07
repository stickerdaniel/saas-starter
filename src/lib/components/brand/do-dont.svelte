<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';

	interface Props {
		label?: string;
		doText: string;
		dontText: string;
	}

	let { label, doText, dontText }: Props = $props();
</script>

<article class="border-border/60 overflow-hidden rounded-2xl border" data-testid="brand-do-dont">
	{#if label}
		<p
			class="border-border/60 text-muted-foreground border-b px-6 py-3 text-xs tracking-wider uppercase"
		>
			{label}
		</p>
	{/if}
	<div class="grid grid-cols-1 md:grid-cols-2">
		<div class="flex items-start gap-3 p-6">
			<span
				class="bg-primary/10 text-primary mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
				aria-hidden="true"
			>
				<Check class="size-3.5" />
			</span>
			<p class="text-base leading-relaxed">{doText}</p>
		</div>
		<div class="border-border/60 flex items-start gap-3 border-t p-6 md:border-t-0 md:border-l">
			<span
				class="text-muted-foreground bg-muted/50 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
				aria-hidden="true"
			>
				<X class="size-3.5" />
			</span>
			<p class="text-muted-foreground text-base leading-relaxed line-through decoration-1">
				{dontText}
			</p>
		</div>
	</div>
</article>
