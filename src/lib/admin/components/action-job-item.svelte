<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import BanIcon from '@lucide/svelte/icons/ban';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import XIcon from '@lucide/svelte/icons/x';
	import { getTranslate } from '@tolgee/svelte';

	interface ActionJob {
		_id: string;
		actionName: string;
		resourceName: string;
		status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
		processedChunks: number;
		totalChunks: number;
		processedIds: number;
		recordIds: string[];
		startedAt: number;
		error?: string;
		[key: string]: unknown;
	}

	interface Props {
		job: ActionJob;
		onCancel: (jobId: string) => void;
	}

	let { job, onCancel }: Props = $props();

	const { t } = getTranslate();

	const progressPercent = $derived(
		job.totalChunks > 0 ? Math.round((job.processedChunks / job.totalChunks) * 100) : 0
	);

	const isActive = $derived(job.status === 'pending' || job.status === 'running');

	const statusBadgeVariant = $derived.by<'default' | 'secondary' | 'destructive' | 'outline'>(
		() => {
			if (job.status === 'completed') return 'default';
			if (job.status === 'failed') return 'destructive';
			if (job.status === 'running') return 'secondary';
			if (job.status === 'cancelled') return 'outline';
			return 'outline';
		}
	);

	function formatRelativeTime(timestamp: number): string {
		const now = Date.now();
		const diffMs = now - timestamp;
		const diffSec = Math.floor(diffMs / 1000);
		const diffMin = Math.floor(diffSec / 60);
		const diffHour = Math.floor(diffMin / 60);

		if (diffSec < 60) return '<1m';
		if (diffMin < 60) return `${diffMin}m`;
		if (diffHour < 24) return `${diffHour}h`;
		return new Date(timestamp).toLocaleDateString();
	}
</script>

<div class="flex items-start gap-3 rounded-md px-3 py-2.5" data-testid="admin-action-job-item">
	<!-- Status icon -->
	<div class="mt-0.5 shrink-0">
		{#if job.status === 'running'}
			<LoaderCircleIcon class="text-primary size-4 animate-spin" />
		{:else if job.status === 'completed'}
			<CircleCheckIcon class="size-4 text-emerald-500" />
		{:else if job.status === 'failed'}
			<CircleXIcon class="text-destructive size-4" />
		{:else if job.status === 'cancelled'}
			<BanIcon class="text-muted-foreground size-4" />
		{:else}
			<ClockIcon class="text-muted-foreground size-4" />
		{/if}
	</div>

	<!-- Content -->
	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-2">
			<span class="text-sm font-medium">{job.actionName}</span>
			<Badge variant={statusBadgeVariant} class="text-[10px] px-1.5 py-0">
				{$t(`admin.resources.queued_actions.status_${job.status}`)}
			</Badge>
		</div>
		<p class="text-muted-foreground text-xs">
			{job.resourceName}
			&middot;
			{$t('admin.resources.queued_actions.progress', {
				processed: job.processedIds,
				total: job.recordIds.length
			})}
		</p>

		{#if isActive || job.status === 'failed'}
			<Progress value={progressPercent} class="mt-1.5 h-1.5" />
		{/if}

		{#if job.error}
			<p class="text-destructive mt-1 text-xs">{job.error}</p>
		{/if}

		<span class="text-muted-foreground mt-0.5 block text-[10px]">
			{formatRelativeTime(job.startedAt)}
		</span>
	</div>

	<!-- Cancel button -->
	{#if isActive}
		<Button
			variant="ghost"
			size="icon"
			class="size-7 shrink-0"
			onclick={(e: MouseEvent) => {
				e.stopPropagation();
				onCancel(job._id);
			}}
			data-testid="admin-action-job-cancel"
		>
			<XIcon class="text-muted-foreground size-3.5" />
			<span class="sr-only">{$t('admin.resources.queued_actions.cancel_job')}</span>
		</Button>
	{/if}
</div>
