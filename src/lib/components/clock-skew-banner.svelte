<script lang="ts">
	import { browser } from '$app/environment';
	import { T } from '@tolgee/svelte';
	import { PersistedState } from 'runed';
	import { clockSkewContext } from '$lib/hooks/clock-skew.svelte';
	import { Button } from '$lib/components/ui/button';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	const skew = clockSkewContext.get();

	// Dismiss for the session only: a wrong clock is rare and the user may be
	// mid-fix, so don't nag across reloads, but reappear in a fresh session if
	// still skewed.
	const dismissed = new PersistedState<boolean>('clock-skew-dismissed', false, {
		storage: 'session'
	});

	const visible = $derived(browser && skew.isSkewed && !dismissed.current);

	function reload() {
		location.reload();
	}
</script>

{#if visible}
	<div
		role="alert"
		data-testid="clock-skew-banner"
		class="sticky top-0 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-b border-warning/20 bg-warning/10 px-4 py-2 text-center text-sm text-foreground backdrop-blur"
	>
		<TriangleAlertIcon class="size-4 shrink-0 text-warning" />
		<span class="min-w-0">
			<T keyName="connection.clock_skew.message" params={{ offset: skew.magnitude }} />
			<T keyName="connection.clock_skew.action" />
		</span>
		<span class="flex shrink-0 gap-2">
			<Button variant="outline" size="sm" onclick={reload} data-testid="clock-skew-reload">
				<T keyName="connection.clock_skew.reload" />
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onclick={() => (dismissed.current = true)}
				data-testid="clock-skew-dismiss"
			>
				<T keyName="connection.clock_skew.dismiss" />
			</Button>
		</span>
	</div>
{/if}
