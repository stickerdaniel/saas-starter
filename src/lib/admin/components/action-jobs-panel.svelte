<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { getTranslate } from '@tolgee/svelte';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import ActionJobItem from './action-job-item.svelte';

	const { t } = getTranslate();
	const client = useConvexClient();

	const activeCountQuery = useQuery(api.adminFramework.actionJobs.countActiveActionJobs, {});
	const jobsQuery = useQuery(api.adminFramework.actionJobs.listActionJobs, {
		numItems: 20
	});

	const activeCount = $derived(activeCountQuery.data ?? 0);
	const jobs = $derived(jobsQuery.data?.items ?? []);
	const isLoading = $derived(jobsQuery.isLoading);

	const displayCount = $derived(activeCount > 99 ? '99+' : String(activeCount));

	async function cancelJob(jobId: string) {
		await client.mutation(api.adminFramework.actionJobs.cancelActionJob, {
			jobId: jobId as any
		});
	}
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<span {...props}>
				<Button
					variant="ghost"
					size="icon"
					class="relative size-8"
					data-testid="admin-action-jobs-bell"
				>
					<ListTodoIcon class="size-4" />
					{#if activeCount > 0}
						<span
							class="bg-primary text-primary-foreground pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium"
						>
							{displayCount}
						</span>
					{/if}
					<span class="sr-only">{$t('admin.resources.queued_actions.panel_title')}</span>
				</Button>
			</span>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" class="w-96 p-0" data-testid="admin-action-jobs-panel">
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-3">
			<h3 class="text-sm font-semibold">
				{$t('admin.resources.queued_actions.panel_title')}
			</h3>
		</div>
		<Separator />

		<!-- Job list -->
		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<div
					class="border-primary size-5 animate-spin rounded-full border-2 border-t-transparent"
				></div>
			</div>
		{:else if jobs.length === 0}
			<Empty.Root class="py-8">
				<Empty.Media>
					<InboxIcon class="text-muted-foreground size-10" />
				</Empty.Media>
				<Empty.Title>{$t('admin.resources.queued_actions.no_active_jobs')}</Empty.Title>
			</Empty.Root>
		{:else}
			<ScrollArea class="max-h-96">
				<div class="py-1">
					{#each jobs as job (job._id)}
						<ActionJobItem {job} onCancel={cancelJob} />
					{/each}
				</div>
			</ScrollArea>
		{/if}
	</Popover.Content>
</Popover.Root>
