<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { useConvexClient } from 'convex-svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import { createDynamicForm } from '$lib/admin/create-dynamic-form.svelte';
	import { getValidationFieldErrors } from '$lib/admin/error-utils';
	import { loadRelationOptionsForFields } from '$lib/admin/relation-options';
	import { isFieldDisabled } from '$lib/admin/visibility';
	import type { FieldDefinition, ResourceDefinition, ResourceRuntime } from '$lib/admin/types';
	import type { BetterAuthUser } from '$lib/convex/admin/types';

	type Props = {
		open: boolean;
		targetResource: ResourceDefinition<any>;
		targetRuntime: ResourceRuntime;
		/** Restrict which fields to show. If undefined, show all form fields. */
		fieldSubset?: string[];
		viewer?: BetterAuthUser;
		onOpenChange: (open: boolean) => void;
		onCreated: (newId: string) => void;
	};

	let { open, targetResource, targetRuntime, fieldSubset, viewer, onOpenChange, onCreated }: Props =
		$props();

	const { t } = getTranslate();
	const client = useConvexClient();

	const formFields: FieldDefinition<any>[] = $derived.by(() => {
		const allFormFields = targetResource.fields.filter((f) => f.showOnForm !== false);
		if (!fieldSubset || fieldSubset.length === 0) return allFormFields;
		return allFormFields.filter((f) => fieldSubset.includes(f.attribute));
	});

	// Placeholder form -- the $effect below re-creates it whenever the modal opens.
	let form = $state(
		createDynamicForm({
			fields: [],
			isEdit: false,
			t: $t
		})
	);

	let relationOptions = $state<Record<string, Array<{ value: string; label: string }>>>({});

	// Re-initialize the form each time the modal opens
	$effect(() => {
		if (open) {
			const fields = formFields;
			const user = viewer;
			form = createDynamicForm({
				fields,
				user,
				isEdit: false,
				t: $t
			});
			relationOptions = {};
			void loadRelations();
		}
	});

	async function loadRelations() {
		try {
			relationOptions = await loadRelationOptionsForFields({
				fields: formFields,
				runtime: targetRuntime,
				client
			});
		} catch (err) {
			console.error(
				`[admin:inline-create:${targetResource.name}] Failed to load relation options`,
				err
			);
		}
	}

	const visibleFormFields = $derived(form.getVisibleFields(null));

	async function handleSubmit() {
		const nextErrors = form.validate(null);
		if (Object.keys(nextErrors).length > 0) return;
		form.setSubmitting(true);
		try {
			const payload = form.normalize(null);
			const newId = await client.mutation(targetRuntime.create, payload as never);
			toast.success($t('admin.resources.toasts.created'));
			onCreated(String(newId));
			onOpenChange(false);
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

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>
				<T
					keyName="admin.resources.form.inline_create_title"
					params={{ resource: $t(targetResource.navTitleKey) }}
				/>
			</Dialog.Title>
			<Dialog.Description>
				<T
					keyName="admin.resources.form.inline_create_description"
					params={{ resource: $t(targetResource.navTitleKey) }}
				/>
			</Dialog.Description>
		</Dialog.Header>

		<div class="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
			<Field.Group>
				{#each visibleFormFields as field (field.attribute)}
					<FieldRenderer
						context="form"
						{field}
						record={form.values}
						value={form.values[field.attribute]}
						error={form.errors[field.attribute]}
						disabled={isFieldDisabled(field, { user: viewer, record: null, isEdit: false })}
						testId={`inline-create-${field.attribute}-input`}
						relationOptions={relationOptions[field.attribute] ?? []}
						allValues={form.values}
						onChange={(value) => {
							form.setValue(field.attribute, value);
						}}
					/>
				{/each}
			</Field.Group>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => onOpenChange(false)}>
				<T keyName="common.cancel" />
			</Button>
			<Button
				onclick={() => void handleSubmit()}
				disabled={form.submitting}
				data-testid="inline-create-submit"
			>
				<T keyName="common.save" />
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
