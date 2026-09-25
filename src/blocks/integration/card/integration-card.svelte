<script lang="ts">
	import IntegrationLearnMoreButton from '$lib/components/ui/owned/integration-learn-more-button.svelte';
	import Card from '$lib/components/ui/card/card.svelte';
	import LearnMoreChevron from '$lib/components/motion/learn-more-chevron.svelte';
	import type { Snippet } from 'svelte';

	type IntegrationCardProps = {
		title: string;
		description: string;
		link?: string;
		secondaryLink?: string;
		secondaryTitle?: string;
		buttonText: string;
		secondaryButtonText?: string;
		children?: Snippet;
	};
	let {
		children,
		title,
		description,
		link = 'https://github.com/SikandarJODD/cnblocks',
		secondaryLink,
		secondaryTitle: _secondaryTitle,
		buttonText,
		secondaryButtonText
	}: IntegrationCardProps = $props();
</script>

<Card class="p-6">
	<div class="relative flex h-full flex-col">
		<div class="*:size-10">{@render children?.()}</div>
		<div class="grow space-y-2 py-6">
			<h3 class="text-base font-medium">{title}</h3>
			<p class="line-clamp-3 text-sm text-muted-foreground">{description}</p>
		</div>
		<div class="flex gap-3 border-t border-dashed pt-6">
			<IntegrationLearnMoreButton href={link} target="_blank">
				{buttonText}
				<LearnMoreChevron class="ml-0 !size-3.5 opacity-50" />
			</IntegrationLearnMoreButton>
			{#if secondaryLink && secondaryButtonText}
				<IntegrationLearnMoreButton href={secondaryLink} target="_blank">
					{secondaryButtonText}
					<LearnMoreChevron class="ml-0 !size-3.5 opacity-50" />
				</IntegrationLearnMoreButton>
			{/if}
		</div>
	</div>
</Card>
