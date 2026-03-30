<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ChatDebugTrace } from './chat-debug-trace.svelte.js';
	import { getLatestTraceEvents } from './chat-debug-trace.svelte.js';

	let { trace }: { trace: ChatDebugTrace } = $props();

	const latestEvents = $derived(getLatestTraceEvents(trace.events));
	const recentEvents = $derived([...trace.events].slice(-30).reverse());
	let copyState = $state<'idle' | 'copied' | 'error'>('idle');

	async function copyTrace() {
		try {
			await navigator.clipboard.writeText(trace.exportJson());
			copyState = 'copied';
			setTimeout(() => {
				copyState = 'idle';
			}, 1500);
		} catch {
			copyState = 'error';
		}
	}
</script>

<div class="fixed right-4 bottom-4 z-50 w-[min(32rem,calc(100vw-2rem))]">
	<div class="rounded-xl border border-border bg-background/95 shadow-2xl backdrop-blur">
		<div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
			<div class="min-w-0">
				<p class="text-sm font-semibold">Chat Trace</p>
				<p class="text-xs text-muted-foreground">{trace.events.length} events captured</p>
			</div>
			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={() => (trace.collapsed = !trace.collapsed)}>
					{trace.collapsed ? 'Open' : 'Hide'}
				</Button>
				<Button variant="outline" size="sm" onclick={copyTrace}>
					{copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy JSON'}
				</Button>
				<Button variant="outline" size="sm" onclick={() => trace.clear()}>Clear</Button>
			</div>
		</div>

		{#if !trace.collapsed}
			<div class="grid gap-3 p-3">
				<section class="grid gap-2">
					<p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Latest By Stage
					</p>
					<div class="max-h-56 overflow-auto rounded-lg border border-border bg-muted/20">
						{#if latestEvents.length === 0}
							<p class="px-3 py-2 text-xs text-muted-foreground">No trace data yet.</p>
						{:else}
							{#each latestEvents as event (`${event.stage}:${event.scope}`)}
								<div class="border-b border-border px-3 py-2 last:border-b-0">
									<div class="flex items-center justify-between gap-2 text-xs">
										<span class="font-medium">{event.stage}</span>
										<span class="text-muted-foreground">{event.scope}</span>
									</div>
									<pre
										class="mt-2 overflow-x-auto text-[10px] leading-4 whitespace-pre-wrap text-foreground">{JSON.stringify(
											event.payload,
											null,
											2
										)}</pre>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<section class="grid gap-2">
					<p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Recent Events
					</p>
					<div class="max-h-72 overflow-auto rounded-lg border border-border bg-muted/20">
						{#if recentEvents.length === 0}
							<p class="px-3 py-2 text-xs text-muted-foreground">No trace data yet.</p>
						{:else}
							{#each recentEvents as event (event.seq)}
								<div class="border-b border-border px-3 py-2 last:border-b-0">
									<div class="flex items-center justify-between gap-2 text-xs">
										<span class="font-medium">
											#{event.seq}
											{event.stage}
										</span>
										<span class="text-muted-foreground">{event.scope}</span>
									</div>
									<pre
										class="mt-2 overflow-x-auto text-[10px] leading-4 whitespace-pre-wrap text-foreground">{JSON.stringify(
											event.payload,
											null,
											2
										)}</pre>
								</div>
							{/each}
						{/if}
					</div>
				</section>
			</div>
		{/if}
	</div>
</div>
