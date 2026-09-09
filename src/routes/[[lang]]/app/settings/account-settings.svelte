<script lang="ts">
	import * as v from 'valibot';
	import { onDestroy } from 'svelte';
	import { authClient } from '$lib/auth-client.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
	import { activeUploadsContext } from '$lib/hooks/active-uploads.svelte.ts';
	import { toast } from 'svelte-sonner';
	import { T, getTranslate } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { getAuthErrorKey } from '$lib/utils/auth-messages.js';
	import { acceptAttribute, UPLOAD_PROFILES } from '$lib/uploads/profiles.js';
	import { getProfileImageInputError, prepareProfileImage } from '$lib/uploads/profile-image.js';
	import {
		isUploadAbort,
		requestUploadGrant,
		uploadGrantedWithAdapter,
		UploadError,
		type UploadAdapter
	} from '$lib/uploads/transfer.js';
	import { translateValidationErrors } from '$lib/utils/validation-i18n.js';

	const { t } = getTranslate();

	const nameSchema = v.object({
		name: v.pipe(v.string(), v.trim(), v.nonEmpty('validation.name.required'))
	});

	interface Props {
		user: {
			name?: string;
			email?: string;
			image?: string | null;
		} | null;
	}

	let { user }: Props = $props();

	const convexClient = useConvexClient();
	const profileImageUploadAdapter: UploadAdapter<string> = {
		grant: () => convexClient.mutation(api.storage.generateUploadUrl, {}),
		commit: ({ storageId, uploadToken }) =>
			convexClient.mutation(api.storage.updateProfileImage, { storageId, uploadToken })
	};
	const profileImageMaxSizeLabel = UPLOAD_PROFILES.profileImage.maxBytesLabel;
	let profileImageUploadController: AbortController | undefined;

	onDestroy(() => profileImageUploadController?.abort());

	// Writable deriveds: editable via bind:value/assignments, re-synced when user changes
	let name = $derived(user?.name ?? '');
	let image = $derived(user?.image ?? '');
	let isUploading = $state(false);
	let uploadProgress = $state(0);
	let isSaving = $state(false);

	// Field errors
	let errors = $state<Record<string, string[]>>({});
	const hasNameError = $derived((errors.name?.length ?? 0) > 0);

	// Let the root layout warn before a page unload discards the transfer.
	const activeUploads = activeUploadsContext.getOr(null);
	const uploadOwner = {};
	$effect(() => {
		if (!activeUploads || !isUploading) return;
		activeUploads.claim(uploadOwner);
		return () => activeUploads.release(uploadOwner);
	});

	async function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];

		if (!file) return;

		haptic.trigger('medium');

		const inputError = getProfileImageInputError(file);
		if (inputError === 'type') {
			toast.error($t('settings.account.avatar.select_error'));
			target.value = '';
			return;
		}
		if (inputError === 'size') {
			toast.error($t('settings.account.avatar.size_error', { size: profileImageMaxSizeLabel }));
			target.value = '';
			return;
		}

		// Avatar policy stays local; the neutral adapter owns only the matching
		// grant, browser transport, commit, and provider-error mechanics.
		isUploading = true;
		uploadProgress = 0;
		const controller = new AbortController();
		profileImageUploadController = controller;

		try {
			// Preserve the existing provider sequence: reserve the upload before
			// preparing the image, then validate the exact bytes being sent.
			const grant = await requestUploadGrant(profileImageUploadAdapter, controller.signal);
			const prepared = await prepareProfileImage(file);
			if (!prepared.ok) {
				toast.error($t('settings.account.avatar.select_error'));
				target.value = '';
				return;
			}

			const { value: imageUrl } = await uploadGrantedWithAdapter({
				adapter: profileImageUploadAdapter,
				grant,
				blob: prepared.blob,
				onProgress: (progress) => {
					uploadProgress = progress;
				},
				signal: controller.signal
			});

			// Update preview (don't save to DB yet)
			image = imageUrl || '';

			haptic.trigger('success');
			toast.success($t('settings.account.avatar.ready'));
		} catch (error) {
			if (isUploadAbort(error)) return;

			haptic.trigger('error');
			if (error instanceof UploadError) {
				switch (error.providerCode) {
					case 'RATE_LIMITED': {
						const retryAfter = error.retryAfterMs ?? 60000;
						toast.error(
							$t('settings.account.avatar.rate_limited', {
								seconds: Math.ceil(retryAfter / 1000)
							})
						);
						break;
					}
					case 'FILE_TOO_LARGE':
						toast.error(
							$t('settings.account.avatar.size_error', { size: profileImageMaxSizeLabel })
						);
						break;
					case 'FILE_TYPE_NOT_ALLOWED':
						toast.error($t('settings.account.avatar.select_error'));
						break;
					default:
						toast.error($t('settings.account.avatar.upload_failed'));
				}
			} else {
				toast.error($t('settings.account.avatar.upload_failed'));
			}
			target.value = '';
		} finally {
			if (profileImageUploadController === controller) {
				profileImageUploadController = undefined;
				isUploading = false;
			}
		}
	}

	function handleRemoveImage() {
		haptic.trigger('warning');
		image = '';
		toast.success($t('settings.account.avatar.removed'));
	}

	function validate(): boolean {
		const result = v.safeParse(nameSchema, { name });
		if (!result.success) {
			const fieldErrors: Record<string, string[]> = {};
			for (const issue of result.issues) {
				const path = (issue.path?.[0]?.key as string) || 'name';
				// Keep the first issue per field so inline errors stay focused and predictable.
				if (!fieldErrors[path]) fieldErrors[path] = [issue.message];
			}
			errors = fieldErrors;
			return false;
		}
		errors = {};
		return true;
	}

	async function handleUpdateProfile(e: Event) {
		e.preventDefault();
		if (!validate()) return;

		isSaving = true;

		try {
			const result = await authClient.updateUser({
				name: name.trim(),
				image: image || null
			});
			if (result.error) {
				console.error('[account-settings] Profile update rejected:', result.error);
				toast.error($t(getAuthErrorKey(result.error)));
				return;
			}

			haptic.trigger('success');
			toast.success($t('settings.account.success'));
		} catch (error) {
			console.error('[account-settings] Profile update failed:', error);
			haptic.trigger('error');
			toast.error($t('settings.account.error'));
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
		<form onsubmit={handleUpdateProfile} novalidate class="space-y-4">
			<Field.Group>
				<Field.Field>
					<Field.Label for="name"><T keyName="settings.account.name_label" /></Field.Label>
					<Input
						id="name"
						type="text"
						bind:value={name}
						placeholder={$t('settings.account.name.placeholder')}
						aria-invalid={hasNameError ? 'true' : undefined}
						aria-describedby={hasNameError ? 'name-error' : undefined}
					/>
					<Field.Error id="name-error" errors={translateValidationErrors(errors.name, $t)} />
					<Field.Description>
						<T keyName="settings.account.name_helper" />
					</Field.Description>
				</Field.Field>
			</Field.Group>

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
						{#if isUploading}
							<div
								class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-border"
								role="status"
							>
								<LoaderCircleIcon class="size-5 text-muted-foreground motion-safe:animate-spin" />
								<span class="sr-only"><T keyName="settings.account.avatar.uploading" /></span>
							</div>
						{:else if image}
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

				<Field.Group>
					<div class="grid gap-6 md:grid-cols-[1fr_auto_1fr] md:items-center">
						<Field.Field>
							<Field.Label for="file-upload">
								<T keyName="settings.account.upload_file" />
							</Field.Label>
							<Input
								id="file-upload"
								type="file"
								accept={acceptAttribute(UPLOAD_PROFILES.profileImage)}
								onchange={handleFileSelect}
								disabled={isUploading}
								aria-describedby="file-helper"
							/>
							{#if isUploading}
								<Progress value={uploadProgress} max={100} class="h-1" />
							{/if}
							<Field.Description id="file-helper">
								<T keyName="settings.account.file_helper" />
							</Field.Description>
						</Field.Field>

						<div class="flex h-10 items-center justify-center">
							<div
								class="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase"
							>
								<span class="hidden h-px w-8 bg-border md:block" aria-hidden="true"></span>
								<span><T keyName="settings.account.or" /></span>
								<span class="hidden h-px w-8 bg-border md:block" aria-hidden="true"></span>
							</div>
						</div>

						<Field.Field>
							<Field.Label for="image">
								<T keyName="settings.account.link_from_url" />
							</Field.Label>
							<Input
								id="image"
								type="url"
								bind:value={image}
								placeholder={$t('settings.account.url_placeholder')}
								aria-describedby="image-helper"
							/>
							<Field.Description id="image-helper">
								<T keyName="settings.account.url_helper" />
							</Field.Description>
						</Field.Field>
					</div>
				</Field.Group>
			</div>

			<div class="flex justify-end">
				<Button type="submit" size="sm" disabled={isSaving}>
					{#if isSaving}
						<T keyName="settings.account.saving" />
					{:else}
						<T keyName="settings.account.save_button" />
					{/if}
				</Button>
			</div>
		</form>
	</Card.Content>
</Card.Root>
