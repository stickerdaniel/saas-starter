<script lang="ts">
	import { T } from '@tolgee/svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import type { ActionDefinition, ActionModalSize } from '$lib/admin/types';
	import type { ChunkProgress } from '$lib/admin/action-response';

	type Props = {
		open: boolean;
		action?: ActionDefinition;
		values: Record<string, unknown>;
		errors?: Record<string, string>;
		relationOptions?: Record<string, Array<{ value: string; label: string }>>;
		relationOptionsLoadError?: boolean;
		onOpenChange: (open: boolean) => void;
		onValueChange: (key: string, value: unknown) => void;
		onConfirm: () => Promise<void>;
		busy?: boolean;
		progress?: ChunkProgress | null;
	};

	let {
		open,
		action,
		values,
		errors = {},
		relationOptions = {},
		relationOptionsLoadError = false,
		onOpenChange,
		onValueChange,
		onConfirm,
		busy = false,
		progress = null
	}: Props = $props();

	const progressPercent = $derived(
		progress ? Math.round((progress.processedIds / progress.totalIds) * 100) : 0
	);

	const windowSizeMap: Record<ActionModalSize, string> = {
		sm: 'sm:max-w-sm',
		md: 'sm:max-w-md',
		lg: 'sm:max-w-lg',
		xl: 'sm:max-w-xl',
		'2xl': 'sm:max-w-2xl'
	};

	const modalClasses = $derived.by(() => {
		const style = action?.modalStyle ?? 'window';
		if (style === 'fullscreen') {
			return 'inset-0 h-full w-full max-w-none translate-x-0 translate-y-0 rounded-none sm:max-w-none';
		}
		const size = action?.modalSize ?? 'lg';
		return windowSizeMap[size];
	});
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class={modalClasses}>
		<Dialog.Header>
			<Dialog.Title>
				{#if action}
					<T keyName={action.nameKey} />
				{/if}
			</Dialog.Title>
			{#if action?.confirmTextKey}
				<Dialog.Description>
					<T keyName={action.confirmTextKey} />
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		<div class="space-y-3">
			{#if relationOptionsLoadError}
				<p class="text-sm text-destructive" data-testid="action-relation-options-load-error">
					<T keyName="admin.resources.toasts.action_error" />
				</p>
			{/if}
			{#each action?.fields ?? [] as field (field.attribute)}
				<FieldRenderer
					context="form"
					{field}
					record={values}
					value={values[field.attribute]}
					error={errors[field.attribute]}
					testId={`action-field-${field.attribute}`}
					relationOptions={relationOptions[field.attribute] ?? []}
					onChange={(value) => onValueChange(field.attribute, value)}
				/>
			{/each}
		</div>

		{#if progress}
			<div class="space-y-2" data-testid="action-chunk-progress">
				<Progress value={progressPercent} max={100} />
				<p class="text-sm text-muted-foreground">
					<T
						keyName="admin.resources.bulk.processing_chunks"
						params={{ current: progress.currentChunk, total: progress.totalChunks }}
					/>
				</p>
				{#if progress.failedChunks > 0}
					<p class="text-sm text-destructive">
						<T
							keyName="admin.resources.bulk.chunks_failed"
							params={{ count: progress.failedChunks }}
						/>
					</p>
				{/if}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => onOpenChange(false)}>
				{#if action?.cancelButtonTextKey}
					<T keyName={action.cancelButtonTextKey} />
				{:else}
					<T keyName="common.cancel" />
				{/if}
			</Button>
			<Button
				variant={action?.destructive ? 'destructive' : 'default'}
				onclick={() => void onConfirm()}
				disabled={busy}
			>
				{#if action?.confirmButtonTextKey}
					<T keyName={action.confirmButtonTextKey} />
				{:else}
					<T keyName="common.confirm" />
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
