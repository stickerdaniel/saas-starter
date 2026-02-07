<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import * as Item from '$lib/components/ui/item/index.js';
	import MetricCard from '$lib/components/ui/metric-card.svelte';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import UsersIcon from '@lucide/svelte/icons/users';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import { T, getTranslate } from '@tolgee/svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { getContext } from 'svelte';

	const { t } = getTranslate();

	// Get user count context from admin layout
	const userCountContext = getContext<{ get: () => number | null; set: (n: number) => void }>(
		'adminUserCount'
	);

	// Fetch dashboard metrics
	const metrics = useQuery(api.admin.queries.getDashboardMetrics, {});

	// Derive loading state
	let isLoading = $derived(!metrics.data);

	// Update user count context when metrics load
	$effect(() => {
		if (metrics.data?.totalUsers !== undefined) {
			userCountContext?.set(metrics.data.totalUsers);
		}
	});
</script>

<SEOHead
	title={$t('meta.admin.dashboard.title')}
	description={$t('meta.admin.dashboard.description')}
/>

<div class="flex flex-col gap-6">
	<!-- Metrics Cards -->
	<div
		class="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card"
	>
		<MetricCard
			label={$t('admin.metrics.total_users')}
			value={metrics.data?.totalUsers ?? 0}
			description={$t('admin.metrics.total_users_desc')}
			subtitle={$t('admin.metrics.registered_users')}
			icon={UsersIcon}
			loading={isLoading}
		/>

		<MetricCard
			label={$t('admin.metrics.active_sessions')}
			value={metrics.data?.activeIn24h ?? 0}
			description={$t('admin.metrics.active_sessions_desc')}
			subtitle={$t('admin.metrics.currently_active')}
			icon={ActivityIcon}
			loading={isLoading}
		/>

		<MetricCard
			label={$t('admin.metrics.recent_signups')}
			value={metrics.data?.recentSignups ?? 0}
			description={$t('admin.metrics.recent_signups_desc')}
			subtitle={$t('admin.metrics.last_7_days')}
			icon={UserPlusIcon}
			loading={isLoading}
		/>

		<MetricCard
			label={$t('admin.metrics.admins')}
			value={metrics.data?.adminCount ?? 0}
			description={$t('admin.metrics.admins_desc')}
			subtitle={$t('admin.metrics.admin_users')}
			icon={ShieldCheckIcon}
			loading={isLoading}
		/>
	</div>

	<!-- External Service Links -->
	<div class="flex flex-col gap-4 px-4 lg:px-6">
		<h2 class="text-lg font-semibold"><T keyName="admin.dashboard.external_services" /></h2>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<Item.Root variant="outline">
				{#snippet child({ props })}
					<a
						href="https://resend.com/overview"
						target="_blank"
						rel="noopener noreferrer"
						{...props}
					>
						<Item.Content>
							<Item.Title>Resend</Item.Title>
							<Item.Description><T keyName="admin.dashboard.email_service" /></Item.Description>
						</Item.Content>
						<Item.Actions>
							<ExternalLinkIcon class="size-4" />
						</Item.Actions>
					</a>
				{/snippet}
			</Item.Root>

			<Item.Root variant="outline">
				{#snippet child({ props })}
					<a
						href="https://dashboard.convex.dev"
						target="_blank"
						rel="noopener noreferrer"
						{...props}
					>
						<Item.Content>
							<Item.Title>Convex</Item.Title>
							<Item.Description><T keyName="admin.dashboard.database_backend" /></Item.Description>
						</Item.Content>
						<Item.Actions>
							<ExternalLinkIcon class="size-4" />
						</Item.Actions>
					</a>
				{/snippet}
			</Item.Root>

			<Item.Root variant="outline">
				{#snippet child({ props })}
					<a
						href="https://vercel.com/dashboard"
						target="_blank"
						rel="noopener noreferrer"
						{...props}
					>
						<Item.Content>
							<Item.Title>Vercel</Item.Title>
							<Item.Description><T keyName="admin.dashboard.hosting_deployment" /></Item.Description
							>
						</Item.Content>
						<Item.Actions>
							<ExternalLinkIcon class="size-4" />
						</Item.Actions>
					</a>
				{/snippet}
			</Item.Root>
		</div>
	</div>
</div>
