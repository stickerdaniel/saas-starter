<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { useConvexClient } from 'convex-svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import { getResourceContext } from '$lib/admin/page-helpers';

	const { t } = getTranslate();
	const client = useConvexClient();
	const { resource, runtime, prefix } = getResourceContext(page.params.resource ?? '');

	const formFields = resource.fields.filter((field) => field.showOnForm !== false);

	let values = $state<Record<string, unknown>>(
		Object.fromEntries(
			formFields.map((field) => [
				field.attribute,
				field.defaultValue ?? (field.type === 'manyToMany' ? [] : '')
			])
		)
	);
	let errors = $state<Record<string, string>>({});
	let relationOptions = $state<Record<string, Array<{ value: string; label: string }>>>({});
	let submitting = $state(false);

	function mapMorphOptions(target: string, options: Array<{ value: string; label: string }>) {
		return options.map((option) => ({
			value: `${target}:${option.value}`,
			label: option.label
		}));
	}

	$effect(() => {
		void (async () => {
			if (!runtime.listRelationOptions) return;
			for (const field of formFields) {
				if (!field.relation) continue;
				if (field.type === 'morphTo') {
					const projectQuery = runtime.listRelationOptions.targetProject;
					const taskQuery = runtime.listRelationOptions.targetTask;
					if (!projectQuery || !taskQuery) continue;
					const [projects, tasks] = await Promise.all([
						client.query(projectQuery, {} as never),
						client.query(taskQuery, {} as never)
					]);
					relationOptions[field.attribute] = [
						...mapMorphOptions('project', projects as Array<{ value: string; label: string }>),
						...mapMorphOptions('task', tasks as Array<{ value: string; label: string }>)
					];
					continue;
				}
				const relationQuery = runtime.listRelationOptions[field.attribute];
				if (!relationQuery) continue;
				const options = await client.query(relationQuery, {} as never);
				relationOptions[field.attribute] = (options as Array<{ value: string; label: string }>).map(
					(option) => ({
						value: String(option.value),
						label: String(option.label)
					})
				);
			}
		})();
	});

	function normalizeValues() {
		const next: Record<string, unknown> = { ...values };
		for (const field of formFields) {
			const current = next[field.attribute];
			if (field.type === 'number') {
				next[field.attribute] = Number(current ?? 0);
			}
			if (field.type === 'boolean') {
				next[field.attribute] = Boolean(current);
			}
			if (field.type === 'morphTo' && typeof current === 'string') {
				const [kind, id] = current.split(':');
				if ((kind === 'project' || kind === 'task') && id) {
					next[field.attribute] = { kind, id };
				}
			}
		}
		return next;
	}

	function validate() {
		const nextErrors: Record<string, string> = {};
		for (const field of formFields) {
			const required = field.readonly !== true;
			const value = values[field.attribute];
			if (!required) continue;
			if (field.type === 'boolean') continue;
			if (field.type === 'manyToMany') continue;
			if (value === undefined || value === null || value === '') {
				nextErrors[field.attribute] = $t('admin.resources.form.required');
			}
		}
		errors = nextErrors;
		return Object.keys(nextErrors).length === 0;
	}

	async function submit() {
		if (!validate()) return;
		submitting = true;
		try {
			const payload = normalizeValues();
			await client.mutation(runtime.create, payload as never);
			toast.success($t('admin.resources.toasts.created'));
			await goto(resolve(`/${page.params.lang}/admin/${resource.name}`));
		} catch (error) {
			const message =
				error instanceof Error ? error.message : $t('admin.resources.toasts.save_error');
			toast.error(message);
		} finally {
			submitting = false;
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
		<Field.Group>
			{#each formFields as field (field.attribute)}
				<FieldRenderer
					context="form"
					{field}
					record={values}
					value={values[field.attribute]}
					error={errors[field.attribute]}
					testId={`${prefix}-${field.attribute}-input`}
					relationOptions={relationOptions[field.attribute] ?? []}
					onChange={(value) => {
						values = {
							...values,
							[field.attribute]: value
						};
					}}
				/>
			{/each}
		</Field.Group>

		<div class="mt-4 flex gap-2">
			<Button
				onclick={() => void submit()}
				disabled={submitting}
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
