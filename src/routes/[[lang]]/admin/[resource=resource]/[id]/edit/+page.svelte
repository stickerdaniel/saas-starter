<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import { getResourceContext } from '$lib/admin/page-helpers';
	import { createDynamicForm } from '$lib/admin/create-dynamic-form.svelte';
	import { resolveFieldGroups } from '$lib/admin/field-groups';
	import { getValidationFieldErrors } from '$lib/admin/error-utils';
	import { loadRelationOptionsForFields } from '$lib/admin/relation-options';
	import { buildTagUpsertHandlers } from '$lib/admin/tag-upsert';
	import { getViewerUser, isFieldDisabled, isResourceUpdatable } from '$lib/admin/visibility';

	const { t } = getTranslate();
	const client = useConvexClient();
	const viewer = getViewerUser(page.data.viewer);
	const { resource, runtime, prefix } = getResourceContext(page.params.resource ?? '', viewer);

	const viaResource = page.url.searchParams.get('via');
	const viaId = page.url.searchParams.get('viaId');
	const returnPath = $derived(
		viaResource && viaId
			? `/${page.params.lang}/admin/${viaResource}/${viaId}`
			: `/${page.params.lang}/admin/${resource.name}/${page.params.id}`
	);

	const detailQuery = useQuery(runtime.getById, { id: page.params.id } as never);
	const ssrRecord = page.data.record as Record<string, unknown> | undefined;
	const record = $derived((detailQuery.data ?? ssrRecord) as Record<string, unknown> | undefined);
	const formFields = resource.fields.filter((field) => field.showOnForm !== false);

	const form = createDynamicForm({
		fields: formFields,
		user: viewer,
		isEdit: true,
		t: $t
	});
	if (ssrRecord) {
		form.initializeFromRecord(ssrRecord);
	}
	let relationOptions = $state<Record<string, Array<{ value: string; label: string }>>>({});
	let relationOptionsVersion = $state(0);
	const tagUpsertHandlers = buildTagUpsertHandlers({
		fields: formFields,
		runtime,
		client,
		onOptionsRefresh: () => {
			relationOptionsVersion += 1;
		}
	});
	type ConflictField = {
		attribute: string;
		labelKey: string;
		localValue: unknown;
		remoteValue: unknown;
	};
	let conflictFields = $state<Record<string, ConflictField>>({});
	let showConflictReview = $state(false);
	const visibleFormFields = $derived(form.getVisibleFields(record ?? null));
	const formGroups = $derived(
		resolveFieldGroups({
			resource,
			context: 'form',
			fields: visibleFormFields
		})
	);
	let activeFormGroup = $state('');
	const canUpdateRecord = $derived.by(() => {
		if (!record) return true;
		return isResourceUpdatable(resource, viewer, record);
	});
	const conflictEntries = $derived(Object.values(conflictFields));

	$effect(() => {
		const first = formGroups[0]?.key ?? '';
		if (!activeFormGroup || !formGroups.some((group) => group.key === activeFormGroup)) {
			activeFormGroup = first;
		}
	});

	$effect(() => {
		const record = detailQuery.data as Record<string, unknown> | undefined;
		if (!record) return;
		if (!form.hydrated) {
			form.initializeFromRecord(record);
			conflictFields = {};
			showConflictReview = false;
			return;
		}

		const { changed, projected } = form.getChangedFields(record);
		if (changed.length === 0) return;

		const overlapping = changed.filter((attribute) => form.dirtyFields.has(attribute));
		form.mergeNonDirty(record);
		if (overlapping.length === 0) {
			conflictFields = {};
			return;
		}

		conflictFields = Object.fromEntries(
			overlapping.map((attribute) => {
				const field = formFields.find((entry) => entry.attribute === attribute);
				return [
					attribute,
					{
						attribute,
						labelKey: field?.labelKey ?? 'admin.resources.columns.actions',
						localValue: form.values[attribute],
						remoteValue: projected[attribute]
					}
				];
			})
		);
	});

	$effect(() => {
		// Re-fetch when version bumps (e.g. after inline tag creation)
		void relationOptionsVersion;
		void (async () => {
			try {
				relationOptions = await loadRelationOptionsForFields({
					fields: formFields,
					runtime,
					client
				});
			} catch (error) {
				console.error(`[admin:${resource.name}] Failed to load relation options`, error);
				toast.error($t('admin.resources.toasts.action_error'));
			}
		})();
	});

	async function reloadRelationOptions() {
		try {
			relationOptions = await loadRelationOptionsForFields({
				fields: formFields,
				runtime,
				client
			});
		} catch (err) {
			console.error(`[admin:${resource.name}] Failed to reload relation options`, err);
		}
	}

	function handleRelationCreated(
		_fieldAttribute: string,
		_newOption: { value: string; label: string }
	) {
		void reloadRelationOptions();
	}

	async function submit() {
		if (!canUpdateRecord) return;
		const currentRecord = record ?? null;
		const nextErrors = form.validate(currentRecord);
		if (Object.keys(nextErrors).length > 0) return;
		form.setSubmitting(true);
		try {
			await client.mutation(runtime.update, {
				id: page.params.id,
				values: form.normalize(currentRecord)
			} as never);
			toast.success($t('admin.resources.toasts.updated'));
			await goto(resolve(returnPath));
		} catch (error) {
			const fieldErrors = getValidationFieldErrors(error);
			if (fieldErrors) {
				form.setErrors({
					...form.errors,
					...fieldErrors
				});
				toast.error($t('admin.resources.form.fix_errors'));
				return;
			}
			const message =
				error instanceof Error ? error.message : $t('admin.resources.toasts.save_error');
			toast.error(message);
		} finally {
			form.setSubmitting(false);
		}
	}

	function discardMyChanges() {
		if (!record) return;
		form.initializeFromRecord(record);
		conflictFields = {};
		showConflictReview = false;
	}

	function keepMine(attribute: string) {
		const conflict = conflictFields[attribute];
		if (!conflict) return;
		form.keepLocalValue(attribute, conflict.remoteValue);
		const next = { ...conflictFields };
		delete next[attribute];
		conflictFields = next;
		if (Object.keys(next).length === 0) {
			showConflictReview = false;
		}
	}

	function useTheirs(attribute: string) {
		const conflict = conflictFields[attribute];
		if (!conflict) return;
		form.useRemoteValue(attribute, conflict.remoteValue);
		const next = { ...conflictFields };
		delete next[attribute];
		conflictFields = next;
		if (Object.keys(next).length === 0) {
			showConflictReview = false;
		}
	}

	function formatConflictValue(value: unknown) {
		if (value === null || value === undefined || value === '') return '-';
		if (typeof value === 'object') {
			return JSON.stringify(value);
		}
		return String(value);
	}
</script>

<SEOHead
	title={$t('meta.admin.resource_edit.title', {
		resource: $t(resource.navTitleKey)
	})}
	description={$t('meta.admin.resource_edit.description', {
		resource: $t(resource.navTitleKey)
	})}
/>

<div class="flex flex-col gap-6 px-4 lg:px-6 xl:px-8 2xl:px-16" data-testid={`${prefix}-edit-page`}>
	<div class="flex items-center justify-between gap-4">
		<h1 class="text-2xl font-bold"><T keyName="admin.resources.actions.edit" /></h1>
	</div>

	{#if detailQuery.isLoading && !form.hydrated}
		<div class="rounded-lg border p-4" data-testid={`${prefix}-edit-loading`}>
			<T keyName="admin.resources.loading" />
		</div>
	{:else if detailQuery.error || (!detailQuery.data && !form.hydrated)}
		<div
			class="flex flex-col items-center gap-4 rounded-lg border p-8 text-center"
			data-testid={`${prefix}-edit-error`}
		>
			<p class="text-sm text-muted-foreground"><T keyName="admin.resources.load_error" /></p>
			<div class="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					onclick={() => goto(resolve(`/${page.params.lang}/admin/${resource.name}`))}
				>
					<ArrowLeftIcon class="mr-2 size-4" />
					<T keyName="aria.go_back" />
				</Button>
				<Button variant="outline" size="sm" onclick={() => location.reload()}>
					<RefreshCwIcon class="mr-2 size-4" />
					<T keyName="common.retry" />
				</Button>
			</div>
		</div>
	{:else if !form.hydrated}
		<div class="rounded-lg border p-4" data-testid={`${prefix}-edit-loading`}>
			<T keyName="admin.resources.loading" />
		</div>
	{:else if !canUpdateRecord}
		<div class="rounded-lg border p-4 text-sm text-muted-foreground">
			<T keyName="admin.resources.empty" />
		</div>
	{:else}
		<div class="rounded-lg border p-4">
			{#if conflictEntries.length > 0}
				<Alert.Root
					variant="destructive"
					class="mb-4"
					data-testid={`${prefix}-edit-conflict-banner`}
				>
					<Alert.Title><T keyName="admin.resources.conflicts.title" /></Alert.Title>
					<Alert.Description>
						<T
							keyName="admin.resources.conflicts.description"
							params={{ count: conflictEntries.length }}
						/>
					</Alert.Description>
					<div class="mt-3 flex flex-wrap gap-2">
						<Button
							size="sm"
							variant="secondary"
							onclick={discardMyChanges}
							data-testid={`${prefix}-edit-conflict-discard`}
						>
							<T keyName="admin.resources.conflicts.discard" />
						</Button>
						<Button
							size="sm"
							variant="outline"
							onclick={() => {
								showConflictReview = !showConflictReview;
							}}
							data-testid={`${prefix}-edit-conflict-review-toggle`}
						>
							<T keyName="admin.resources.conflicts.review" />
						</Button>
					</div>
				</Alert.Root>
			{/if}

			{#if showConflictReview && conflictEntries.length > 0}
				<div class="mb-4 rounded-lg border p-4" data-testid={`${prefix}-edit-conflict-review`}>
					<div class="space-y-3">
						{#each conflictEntries as conflict (conflict.attribute)}
							<div
								class="rounded-md border p-3"
								data-testid={`${prefix}-edit-conflict-${conflict.attribute}`}
							>
								<p class="text-sm font-medium"><T keyName={conflict.labelKey} /></p>
								<p class="mt-1 text-xs text-muted-foreground">
									<T keyName="admin.resources.conflicts.local_value" />:
									{formatConflictValue(conflict.localValue)}
								</p>
								<p class="text-xs text-muted-foreground">
									<T keyName="admin.resources.conflicts.remote_value" />:
									{formatConflictValue(conflict.remoteValue)}
								</p>
								<div class="mt-2 flex flex-wrap gap-2">
									<Button
										size="sm"
										variant="outline"
										onclick={() => keepMine(conflict.attribute)}
										data-testid={`${prefix}-edit-conflict-keep-${conflict.attribute}`}
									>
										<T keyName="admin.resources.conflicts.keep_mine" />
									</Button>
									<Button
										size="sm"
										variant="secondary"
										onclick={() => useTheirs(conflict.attribute)}
										data-testid={`${prefix}-edit-conflict-use-${conflict.attribute}`}
									>
										<T keyName="admin.resources.conflicts.use_theirs" />
									</Button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if formGroups.length > 1}
				<Tabs.Root value={activeFormGroup} onValueChange={(next) => (activeFormGroup = next)}>
					<Tabs.List data-testid={`${prefix}-edit-form-tabs`}>
						{#each formGroups as group (group.key)}
							<Tabs.Trigger value={group.key} data-testid={`${prefix}-edit-form-tab-${group.key}`}>
								<T keyName={group.labelKey} />
							</Tabs.Trigger>
						{/each}
					</Tabs.List>
					{#each formGroups as group (group.key)}
						<Tabs.Content value={group.key}>
							<Field.Group>
								{#each group.fields as field (field.attribute)}
									<div
										class={conflictFields[field.attribute]
											? 'rounded-md border border-destructive/40 p-2'
											: ''}
									>
										<FieldRenderer
											context="form"
											{field}
											record={form.values}
											value={form.values[field.attribute]}
											error={form.errors[field.attribute]}
											disabled={isFieldDisabled(field, {
												user: viewer,
												record,
												isEdit: true
											})}
											testId={`${prefix}-${field.attribute}-input`}
											relationOptions={relationOptions[field.attribute] ?? []}
											{viewer}
											onChange={(value) => {
												form.setValue(field.attribute, value);
											}}
											onRelationCreated={handleRelationCreated}
											onCreateTag={tagUpsertHandlers[field.attribute]}
										/>
									</div>
								{/each}
							</Field.Group>
						</Tabs.Content>
					{/each}
				</Tabs.Root>
			{:else}
				<Field.Group>
					{#each visibleFormFields as field (field.attribute)}
						<div
							class={conflictFields[field.attribute]
								? 'rounded-md border border-destructive/40 p-2'
								: ''}
						>
							<FieldRenderer
								context="form"
								{field}
								record={form.values}
								value={form.values[field.attribute]}
								error={form.errors[field.attribute]}
								disabled={isFieldDisabled(field, {
									user: viewer,
									record,
									isEdit: true
								})}
								testId={`${prefix}-${field.attribute}-input`}
								relationOptions={relationOptions[field.attribute] ?? []}
								{viewer}
								onChange={(value) => {
									form.setValue(field.attribute, value);
								}}
								onRelationCreated={handleRelationCreated}
								onCreateTag={tagUpsertHandlers[field.attribute]}
							/>
						</div>
					{/each}
				</Field.Group>
			{/if}

			<div class="mt-4 flex gap-2">
				<Button
					onclick={() => void submit()}
					disabled={form.submitting}
					data-testid={`${prefix}-edit-submit`}
				>
					<T keyName="common.save" />
				</Button>
				<Button
					variant="outline"
					onclick={() => goto(resolve(returnPath))}
					data-testid={`${prefix}-edit-cancel`}
				>
					<T keyName="common.cancel" />
				</Button>
			</div>
		</div>
	{/if}
</div>
