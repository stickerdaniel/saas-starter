<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { T, getTranslate } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { FieldDefinition } from '$lib/admin/types';
	import { getResourceByName } from '$lib/admin/registry';
	import { adminResourceRuntimeMap } from '$lib/admin/runtime';
	import { ConfirmDeleteDialog, confirmDelete } from '$lib/components/ui/confirm-delete-dialog';

	type Props = {
		field: FieldDefinition<any>;
		record: Record<string, unknown>;
		lang: string;
		prefix: string;
	};

	let { field, record, lang, prefix }: Props = $props();

	const client = useConvexClient();
	const { t } = getTranslate();

	const relatedResource = $derived.by(() => {
		const resourceName = field.relation?.resourceName;
		if (!resourceName) return undefined;
		return getResourceByName(resourceName);
	});
	const relatedRuntime = $derived.by(() => {
		if (!relatedResource) return undefined;
		return adminResourceRuntimeMap[relatedResource.name];
	});
	const foreignKey = $derived(field.relation?.foreignKey ?? '');
	const parentId = $derived(String(record._id ?? ''));

	let relatedRows = $state<Record<string, unknown>[]>([]);
	let loading = $state(false);
	let loadError = $state(false);

	$effect(() => {
		void (async () => {
			if (!relatedRuntime || !foreignKey || !parentId) {
				relatedRows = [];
				return;
			}
			loading = true;
			loadError = false;
			try {
				const result = (await client.query(relatedRuntime.list, {
					cursor: undefined,
					numItems: 10,
					filters: {
						[foreignKey]: parentId
					},
					trashed: 'with'
				} as never)) as {
					items?: Record<string, unknown>[];
				};
				relatedRows = result.items ?? [];
			} catch (error) {
				console.error(
					`[admin:related-table:${field.attribute}] Failed to load related rows`,
					error
				);
				relatedRows = [];
				loadError = true;
			} finally {
				loading = false;
			}
		})();
	});

	async function openRow(id: string) {
		if (!relatedResource) return;
		await goto(resolve(`/${lang}/admin/${relatedResource.name}/${id}`));
	}

	async function openEditRow(id: string) {
		if (!relatedResource) return;
		await goto(resolve(`/${lang}/admin/${relatedResource.name}/${id}/edit`));
	}

	async function createRelated() {
		if (!relatedResource) return;
		await goto(resolve(`/${lang}/admin/${relatedResource.name}/create`));
	}

	function deleteRow(id: string) {
		if (!relatedRuntime) return;
		confirmDelete({
			title: $t('admin.resources.actions.delete'),
			description: $t('admin.resources.confirm.delete_description'),
			confirm: { text: $t('admin.resources.actions.delete') },
			cancel: { text: $t('common.cancel') },
			onConfirm: async () => {
				await client.mutation(relatedRuntime.delete, { id } as never);
				relatedRows = relatedRows.filter((row) => String(row._id) !== id);
				toast.success($t('admin.resources.toasts.deleted'));
			}
		});
	}
</script>

{#if relatedResource && relatedRuntime && foreignKey}
	<div class="space-y-3" data-testid={`${prefix}-${field.attribute}-related-table`}>
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-medium"><T keyName={field.labelKey} /></h3>
			<Button size="sm" variant="outline" onclick={() => void createRelated()}>
				<PlusIcon class="mr-2 size-4" />
				<T keyName="admin.resources.actions.create" />
			</Button>
		</div>
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head><T keyName={relatedResource.navTitleKey} /></Table.Head>
					<Table.Head class="w-40 text-right"
						><T keyName="admin.resources.columns.actions" /></Table.Head
					>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if loading}
					<Table.Row>
						<Table.Cell colspan={2} class="text-muted-foreground">
							<T keyName="admin.resources.loading" />
						</Table.Cell>
					</Table.Row>
				{:else if loadError}
					<Table.Row>
						<Table.Cell colspan={2} class="text-muted-foreground">
							<T keyName="admin.resources.load_error" />
						</Table.Cell>
					</Table.Row>
				{:else if relatedRows.length === 0}
					<Table.Row>
						<Table.Cell colspan={2} class="text-muted-foreground">
							<T keyName="admin.resources.empty" />
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each relatedRows as row (String(row._id))}
						<Table.Row>
							<Table.Cell>{relatedResource.title(row)}</Table.Cell>
							<Table.Cell class="text-right">
								<div class="flex justify-end gap-1">
									<Button variant="ghost" size="icon" onclick={() => void openRow(String(row._id))}>
										<EyeIcon class="size-4" />
										<span class="sr-only"><T keyName="admin.resources.actions.view" /></span>
									</Button>
									<Button
										variant="ghost"
										size="icon"
										onclick={() => void openEditRow(String(row._id))}
									>
										<PencilIcon class="size-4" />
										<span class="sr-only"><T keyName="admin.resources.actions.edit" /></span>
									</Button>
									<Button variant="ghost" size="icon" onclick={() => deleteRow(String(row._id))}>
										<Trash2Icon class="size-4" />
										<span class="sr-only"><T keyName="admin.resources.actions.delete" /></span>
									</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
{/if}

<ConfirmDeleteDialog />
