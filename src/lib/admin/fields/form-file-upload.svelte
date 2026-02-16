<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import XIcon from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import type { FieldDefinition } from '$lib/admin/types';
	import { api } from '$lib/convex/_generated/api';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		error?: string;
		disabled?: boolean;
		testId?: string;
		onChange: (value: unknown) => void;
	};

	let { field, value, error, disabled = false, testId, onChange }: Props = $props();

	const { t } = getTranslate();
	const client = useConvexClient();
	const storageApi = api as unknown as {
		storage: {
			generateUploadUrl: any;
			finalizeAdminUpload: any;
		};
	};
	let uploading = $state(false);
	let progress = $state(0);
	let fileInputEl: HTMLInputElement | undefined = $state();

	const currentValue = $derived(typeof value === 'string' ? value : '');
	const accept = $derived(
		field.type === 'image' ? 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml' : '*/*'
	);

	async function uploadToStorage(
		uploadUrl: string,
		file: File,
		onProgress: (nextProgress: number) => void
	) {
		return await new Promise<string>((resolve, reject) => {
			const xhr = new XMLHttpRequest();

			xhr.upload.addEventListener('progress', (event) => {
				if (!event.lengthComputable) return;
				onProgress(Math.round((event.loaded / event.total) * 100));
			});

			xhr.addEventListener('load', () => {
				if (xhr.status !== 200) {
					reject(new Error(`Upload failed with status ${xhr.status}`));
					return;
				}
				try {
					const response = JSON.parse(xhr.responseText) as { storageId?: string };
					if (!response.storageId) {
						reject(new Error('Upload response missing storageId'));
						return;
					}
					resolve(response.storageId);
				} catch {
					reject(new Error('Could not parse upload response'));
				}
			});

			xhr.addEventListener('error', () => reject(new Error('Upload failed')));
			xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

			xhr.open('POST', uploadUrl);
			xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
			xhr.send(file);
		});
	}

	async function handleFileSelect(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		uploading = true;
		progress = 0;
		try {
			const { uploadUrl, uploadToken } = (await client.mutation(
				storageApi.storage.generateUploadUrl,
				{}
			)) as { uploadUrl: string; uploadToken: string };
			const storageId = await uploadToStorage(uploadUrl, file, (nextProgress) => {
				progress = nextProgress;
			});
			const result = (await client.mutation(storageApi.storage.finalizeAdminUpload, {
				storageId: storageId as never,
				uploadToken,
				kind: field.type === 'image' ? 'image' : 'file'
			})) as { url: string };

			onChange(result.url);
			toast.success($t('admin.resources.toasts.updated'));
		} catch (error) {
			const message =
				error instanceof Error ? error.message : $t('admin.resources.toasts.save_error');
			toast.error(message);
		} finally {
			uploading = false;
			progress = 0;
			if (fileInputEl) {
				fileInputEl.value = '';
			}
		}
	}

	function handleRemove() {
		onChange('');
		if (fileInputEl) {
			fileInputEl.value = '';
		}
	}
</script>

<Field.Field>
	<Field.Label><T keyName={field.labelKey} /></Field.Label>
	<div class="space-y-2">
		{#if currentValue && field.type === 'image'}
			<div class="relative inline-block">
				<img src={currentValue} alt="" class="max-h-40 rounded border object-cover" />
				{#if !disabled && !uploading}
					<Button
						variant="destructive"
						size="icon"
						class="absolute -right-2 -top-2 size-6"
						onclick={handleRemove}
						data-testid={testId ? `${testId}-remove` : undefined}
					>
						<XIcon class="size-3" />
						<span class="sr-only"><T keyName="common.remove" /></span>
					</Button>
				{/if}
			</div>
		{:else if currentValue && field.type === 'file'}
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="text-sm text-primary underline"
					onclick={() => window.open(currentValue, '_blank', 'noopener,noreferrer')}
					data-testid={testId ? `${testId}-open` : undefined}
				>
					{currentValue}
				</button>
				{#if !disabled && !uploading}
					<Button
						variant="ghost"
						size="icon"
						class="size-6"
						onclick={handleRemove}
						data-testid={testId ? `${testId}-remove` : undefined}
					>
						<XIcon class="size-3" />
						<span class="sr-only"><T keyName="common.remove" /></span>
					</Button>
				{/if}
			</div>
		{/if}

		{#if uploading}
			<Progress value={progress} max={100} />
			<p class="text-xs text-muted-foreground">{progress}%</p>
		{:else if !disabled}
			<input
				bind:this={fileInputEl}
				type="file"
				{accept}
				class="hidden"
				onchange={handleFileSelect}
				data-testid={testId ? `${testId}-file-input` : undefined}
			/>
			<Button
				variant="outline"
				size="sm"
				onclick={() => fileInputEl?.click()}
				{disabled}
				data-testid={testId}
			>
				<UploadIcon class="mr-2 size-4" />
				<T keyName="admin.resources.form.upload" />
			</Button>
		{/if}
	</div>

	{#if field.helpTextKey}
		<Field.Description><T keyName={field.helpTextKey} /></Field.Description>
	{/if}

	{#if error}
		<Field.Error>{error}</Field.Error>
	{/if}
</Field.Field>
