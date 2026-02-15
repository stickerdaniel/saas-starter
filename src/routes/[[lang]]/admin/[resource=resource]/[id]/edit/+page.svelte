<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import FieldRenderer from '$lib/admin/fields/field-renderer.svelte';
	import { getResourceContext } from '$lib/admin/page-helpers';

	const { t } = getTranslate();
	const client = useConvexClient();
	const { resource, runtime, prefix } = getResourceContext(page.params.resource ?? '');

	const detailQuery = useQuery(runtime.getById, { id: page.params.id } as never);
	const formFields = resource.fields.filter((field) => field.showOnForm !== false);

	let values = $state<Record<string, unknown>>({});
	let relationOptions = $state<Record<string, Array<{ value: string; label: string }>>>({});
	let errors = $state<Record<string, string>>({});
	let submitting = $state(false);
	let hydrated = $state(false);

	function mapMorphOptions(target: string, options: Array<{ value: string; label: string }>) {
		return options.map((option) => ({
			value: `${target}:${option.value}`,
			label: option.label
		}));
	}

	$effect(() => {
		if (!detailQuery.data || hydrated) return;
		values = Object.fromEntries(
			formFields.map((field) => {
				if (field.type === 'manyToMany') {
					const tags = (detailQuery.data?.tags as Array<{ _id: string }> | undefined) ?? [];
					return [field.attribute, tags.map((tag) => tag._id)];
				}
				if (field.type === 'morphTo') {
					const target = detailQuery.data?.target as { kind: string; id: string } | undefined;
					if (!target) return [field.attribute, ''];
					return [field.attribute, `${target.kind}:${target.id}`];
				}
				return [field.attribute, detailQuery.data?.[field.attribute] ?? ''];
			})
		);
		hydrated = true;
	});

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
			const value = values[field.attribute];
			if (field.type === 'boolean' || field.type === 'manyToMany') continue;
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
			await client.mutation(runtime.update, {
				id: page.params.id,
				values: normalizeValues()
			} as never);
			toast.success($t('admin.resources.toasts.updated'));
			await goto(resolve(`/${page.params.lang}/admin/${resource.name}/${page.params.id}`));
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

	{#if detailQuery.isLoading || !hydrated}
		<div class="rounded-lg border p-4" data-testid={`${prefix}-edit-loading`}>
			<T keyName="admin.resources.loading" />
		</div>
	{:else}
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
					data-testid={`${prefix}-edit-submit`}
				>
					<T keyName="common.save" />
				</Button>
				<Button
					variant="outline"
					onclick={() =>
						goto(resolve(`/${page.params.lang}/admin/${resource.name}/${page.params.id}`))}
					data-testid={`${prefix}-edit-cancel`}
				>
					<T keyName="common.cancel" />
				</Button>
			</div>
		</div>
	{/if}
</div>
