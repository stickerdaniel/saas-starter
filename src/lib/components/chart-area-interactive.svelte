<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
</script>

<Card.Root class="@container/card">
	<Card.Header>
		<Card.Title>Total Visitors</Card.Title>
		<Card.Description>
			<span class="hidden @[540px]/card:block"> Total for the last 3 months </span>
			<span class="@[540px]/card:hidden">Last 3 months</span>
		</Card.Description>
	</Card.Header>
	<Card.Content class="px-2 pt-4 sm:px-6 sm:pt-6">
		<div class="flex h-[250px] w-full items-center justify-center rounded-xl bg-muted/50">
			<p class="text-sm text-muted-foreground">
				Chart temporarily disabled for server-rendered builds.
			</p>
		</div>
	</Card.Content>
</Card.Root>
