<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { error } from '@sveltejs/kit';
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { useConvexClient } from 'convex-svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { getResourceContext } from '$lib/admin/page-helpers';
	import { createDynamicForm } from '$lib/admin/create-dynamic-form.svelte';
	import { resolveFieldGroups } from '$lib/admin/field-groups';
	import { getValidationFieldErrors } from '$lib/admin/error-utils';
	import { loadRelationOptionsForFields } from '$lib/admin/relation-options';
	import { getViewerUser, isFieldDisabled, isResourceCreatable } from '$lib/admin/visibility';

	const { t } = getTranslate();
	const client = useConvexClient();
	const viewer = getViewerUser(page.data.viewer);
	const { resource, runtime, prefix } = getResourceContext(page.params.resource ?? '', viewer);
	if (!isResourceCreatable(resource, viewer)) {
		throw error(403, 'Not allowed');
	}

	const formFields = resource.fields.filter((field) => field.showOnForm !== false);
	const form = createDynamicForm({
		fields: formFields,
		user: viewer,
		isEdit: false,
		t: $t
	});
	let relationOptions = $state<Record<string, Array<{ value: string; label: string }>>>({});
	const visibleFormFields = $derived(form.getVisibleFields(null));
	const formGroups = $derived(
		resolveFieldGroups({
			resource,
			context: 'form',
			fields: visibleFormFields
		})
	);
	let activeFormGroup = $state('');

	$effect(() => {
		const first = formGroups[0]?.key ?? '';
		if (!activeFormGroup || !formGroups.some((group) => group.key === activeFormGroup)) {
			activeFormGroup = first;
		}
	});

	$effect(() => {
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
		const nextErrors = form.validate(null);
		if (Object.keys(nextErrors).length > 0) return;
		form.setSubmitting(true);
		try {
			const payload = form.normalize(null);
			await client.mutation(runtime.create, payload as never);
			toast.success($t('admin.resources.toasts.created'));
			await goto(resolve(`/${page.params.lang}/admin/${resource.name}`));
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
</script>

<SEOHead
	title={$t('meta.admin.resource_create.title', {
		resource: $t(resource.navTitleKey)
	})}
	description={$t('meta.admin.resource_create.description', {
		resource: $t(resource.navTitleKey)
	})}
/>

<div
	class="flex flex-col gap-6 px-4 lg:px-6 xl:px-8 2xl:px-16"
	data-testid={`${prefix}-create-page`}
>
	<div class="flex items-center justify-between gap-4">
		<h1 class="text-2xl font-bold">
			<T
				keyName="admin.resources.actions.create_resource"
				params={{ resource: $t(resource.navTitleKey) }}
			/>
		</h1>
	</div>

	<div class="rounded-lg border p-4">
		{#if formGroups.length > 1}
			<Tabs.Root value={activeFormGroup} onValueChange={(next) => (activeFormGroup = next)}>
				<Tabs.List data-testid={`${prefix}-form-tabs`}>
					{#each formGroups as group (group.key)}
						<Tabs.Trigger value={group.key} data-testid={`${prefix}-form-tab-${group.key}`}>
							<T keyName={group.labelKey} />
						</Tabs.Trigger>
					{/each}
				</Tabs.List>
				{#each formGroups as group (group.key)}
					<Tabs.Content value={group.key}>
						<Field.Group>
							{#each group.fields as field (field.attribute)}
								<FieldRenderer
									context="form"
									{field}
									record={form.values}
									value={form.values[field.attribute]}
									error={form.errors[field.attribute]}
									disabled={isFieldDisabled(field, { user: viewer, record: null, isEdit: false })}
									testId={`${prefix}-${field.attribute}-input`}
									relationOptions={relationOptions[field.attribute] ?? []}
									{viewer}
									onChange={(value) => {
										form.setValue(field.attribute, value);
									}}
									onRelationCreated={handleRelationCreated}
								/>
							{/each}
						</Field.Group>
					</Tabs.Content>
				{/each}
			</Tabs.Root>
		{:else}
			<Field.Group>
				{#each visibleFormFields as field (field.attribute)}
					<FieldRenderer
						context="form"
						{field}
						record={form.values}
						value={form.values[field.attribute]}
						error={form.errors[field.attribute]}
						disabled={isFieldDisabled(field, { user: viewer, record: null, isEdit: false })}
						testId={`${prefix}-${field.attribute}-input`}
						relationOptions={relationOptions[field.attribute] ?? []}
						{viewer}
						onChange={(value) => {
							form.setValue(field.attribute, value);
						}}
						onRelationCreated={handleRelationCreated}
					/>
				{/each}
			</Field.Group>
		{/if}

		<div class="mt-4 flex gap-2">
			<Button
				onclick={() => void submit()}
				disabled={form.submitting}
				data-testid={`${prefix}-create-submit`}
			>
				<T keyName="common.save" />
			</Button>
			<Button
				variant="outline"
				onclick={() => goto(resolve(`/${page.params.lang}/admin/${resource.name}`))}
				data-testid={`${prefix}-create-cancel`}
			>
				<T keyName="common.cancel" />
			</Button>
		</div>
	</div>
</div>
