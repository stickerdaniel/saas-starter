<script lang="ts">
	import { authClient } from '$lib/auth-client.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { toast } from 'svelte-sonner';
	import { T, getTranslate } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { PROFILE_IMAGE_MAX_SIZE, PROFILE_IMAGE_MAX_SIZE_LABEL } from '$lib/convex/constants.js';

	const { t } = getTranslate();

	interface Props {
		user: {
			name?: string;
			email?: string;
			image?: string | null;
		} | null;
	}

	let { user }: Props = $props();

	const convexClient = useConvexClient();

	let name = $state(user?.name || '');
	let image = $state(user?.image || '');
	let isUploading = $state(false);
	let isSaving = $state(false);
	let fileInput = $state<HTMLInputElement>();

	// Update reactive values when user changes
	$effect(() => {
		if (user) {
			name = user.name || '';
			image = user.image || '';
		}
	});

	async function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];

		if (!file) return;

		// Validate file type
		if (!file.type.startsWith('image/')) {
			toast.error($t('settings.account.avatar.select_error'));
			target.value = '';
			return;
		}

		// Validate file size
		if (file.size > PROFILE_IMAGE_MAX_SIZE) {
			toast.error($t('settings.account.avatar.size_error', { size: PROFILE_IMAGE_MAX_SIZE_LABEL }));
			target.value = '';
			return;
		}

		// Auto-upload to Convex storage
		isUploading = true;
		try {
			const uploadUrl = await convexClient.mutation(api.storage.generateUploadUrl, {});

			const result = await fetch(uploadUrl, {
				method: 'POST',
				headers: { 'Content-Type': file.type },
				body: file
			});

			const { storageId } = await result.json();

			const imageUrl = await convexClient.mutation(api.storage.updateProfileImage, { storageId });

			// Update preview (don't save to DB yet)
			image = imageUrl || '';

			toast.success($t('settings.account.avatar.ready'));
		} catch (error) {
			const message =
				error instanceof Error ? error.message : $t('settings.account.avatar.upload_failed');
			toast.error(message);
			target.value = '';
		} finally {
			isUploading = false;
		}
	}

	function handleRemoveImage() {
		image = '';
		toast.success($t('settings.account.avatar.removed'));
	}

	async function handleUpdateProfile(e: Event) {
		e.preventDefault();
		isSaving = true;

		try {
			await authClient.updateUser({
				name,
				image: image || null
			});

			toast.success($t('settings.account.success'));
		} catch (error) {
			const message = error instanceof Error ? error.message : $t('settings.account.error');
			toast.error(message);
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><T keyName="settings.account.title" /></Card.Title>
		<Card.Description><T keyName="settings.account.description" /></Card.Description>
	</Card.Header>
	<Card.Content>
		<form onsubmit={handleUpdateProfile} class="space-y-4">
			<div class="space-y-2">
				<Label for="name"><T keyName="settings.account.name_label" /></Label>
				<Input
					id="name"
					type="text"
					bind:value={name}
					placeholder={$t('settings.account.name.placeholder')}
					required
				/>
				<p class="text-sm text-muted-foreground">
					<T keyName="settings.account.name_helper" />
				</p>
			</div>

			<div class="space-y-4">
				<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div class="space-y-1">
						<p class="text-sm font-semibold">
							<T keyName="settings.account.profile_picture" />
						</p>
						<p class="text-sm text-muted-foreground">
							<T keyName="settings.account.profile_picture_helper" />
						</p>
					</div>
					<div class="flex items-center gap-3">
						{#if image}
							<img
								src={image}
								alt={$t('settings.account.avatar.alt')}
								class="h-16 w-16 rounded-full border-2 border-border object-cover"
								onerror={(e) => {
									if (e.target instanceof HTMLImageElement) {
										e.target.style.display = 'none';
									}
								}}
							/>
						{:else}
							<div
								class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-border text-xs text-muted-foreground"
							>
								<T keyName="settings.account.no_image" />
							</div>
						{/if}
						{#if image}
							<Button
								type="button"
								variant="outline"
								size="sm"
								onclick={handleRemoveImage}
								disabled={isSaving}
							>
								<T keyName="settings.account.remove_button" />
							</Button>
						{/if}
					</div>
				</div>

				<div class="grid gap-6 md:grid-cols-[1fr_auto_1fr] md:items-center">
					<div class="space-y-2">
						<Label for="file-upload">
							<T keyName="settings.account.upload_file" />
						</Label>
						<input
							bind:this={fileInput}
							id="file-upload"
							type="file"
							accept="image/*"
							onchange={handleFileSelect}
							disabled={isUploading}
							aria-describedby="file-helper"
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
						/>
						<p id="file-helper" class="text-sm text-muted-foreground">
							<T keyName="settings.account.file_helper" />
						</p>
					</div>

					<div class="flex h-10 items-center justify-center">
						<div
							class="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase"
						>
							<span class="hidden h-px w-8 bg-border md:block" aria-hidden="true"></span>
							<span><T keyName="settings.account.or" /></span>
							<span class="hidden h-px w-8 bg-border md:block" aria-hidden="true"></span>
						</div>
					</div>

					<div class="space-y-2">
						<Label for="image">
							<T keyName="settings.account.link_from_url" />
						</Label>
						<Input
							id="image"
							type="url"
							bind:value={image}
							placeholder={$t('settings.account.url_placeholder')}
							aria-describedby="image-helper"
						/>
						<p id="image-helper" class="text-sm text-muted-foreground">
							<T keyName="settings.account.url_helper" />
						</p>
					</div>
				</div>
			</div>

			<Button type="submit" disabled={isSaving}>
				{#if isSaving}
					<T keyName="settings.account.saving" />
				{:else}
					<T keyName="settings.account.save_button" />
				{/if}
			</Button>
		</form>
	</Card.Content>
</Card.Root>
