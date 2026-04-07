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

<article class="overflow-hidden rounded-2xl border border-border/60" data-testid="brand-do-dont">
	{#if label}
		<p
			class="border-b border-border/60 px-6 py-3 text-xs tracking-wider text-muted-foreground uppercase"
		>
			{label}
		</p>
	{/if}
	<div class="grid grid-cols-1 md:grid-cols-2">
		<div class="flex items-start gap-3 p-6">
			<span
				class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
				aria-hidden="true"
			>
				<Check class="size-3.5" />
			</span>
			<p class="text-base leading-relaxed">{doText}</p>
		</div>
		<div class="flex items-start gap-3 border-t border-border/60 p-6 md:border-t-0 md:border-l">
			<span
				class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/50 text-muted-foreground"
				aria-hidden="true"
			>
				<X class="size-3.5" />
			</span>
			<p class="text-base leading-relaxed text-muted-foreground line-through decoration-1">
				{dontText}
			</p>
		</div>
	</div>
</article>
