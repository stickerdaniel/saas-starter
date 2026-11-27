<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { toast, type ToastT } from 'svelte-sonner';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import { cn } from '#lib/utils.js';

	const { t } = getTranslate();
	const toasts = $derived(toast.getActiveToasts().filter((item) => typeof item.title === 'string'));

	function dismissAfterDuration(item: ToastT) {
		return () => {
			const duration = item.duration ?? 4000;
			if (item.type === 'loading' || !Number.isFinite(duration)) return;
			const timer = setTimeout(() => toast.dismiss(item.id), duration);
			return () => clearTimeout(timer);
		};
	}
</script>

{#if toasts.length > 0}
	<section
		aria-live="polite"
		class="fixed right-4 bottom-4 left-4 z-100 flex flex-col gap-2 sm:left-auto sm:w-80"
	>
		{#each toasts as item (item.id)}
			<div
				data-testid="toast-fallback"
				class="flex items-center gap-3 rounded-md bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
				{@attach dismissAfterDuration(item)}
			>
				<div class="min-w-0 flex-1">
					<p>{item.title}</p>
					{#if typeof item.description === 'string'}
						<p class="text-muted-foreground">{item.description}</p>
					{/if}
				</div>
				{#if typeof item.action === 'object' && typeof item.action.label === 'string'}
					{@const action = item.action}
					<button
						type="button"
						class={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
						onclick={(event) => {
							action.onClick(event);
							if (!event.defaultPrevented) toast.dismiss(item.id);
						}}
					>
						{action.label}
					</button>
				{/if}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={$t('aria.close')}
					onclick={() => toast.dismiss(item.id)}
				>
					<XIcon />
				</Button>
			</div>
		{/each}
	</section>
{/if}
