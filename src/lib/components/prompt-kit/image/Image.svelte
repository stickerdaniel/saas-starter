<script lang="ts">
	// @todo unused component — delete if still unused by next audit
	import { cn } from '$lib/utils';
	import type { HTMLImgAttributes } from 'svelte/elements';

	export type GeneratedImageLike = {
		base64?: string;
		uint8Array?: Uint8Array;
		mediaType?: string;
	};

	type Props = GeneratedImageLike & {
		alt: string;
		class?: string;
	} & Omit<HTMLImgAttributes, 'src' | 'alt' | 'class'>;

	let {
		base64,
		uint8Array,
		mediaType = 'image/png',
		class: className,
		alt,
		...props
	}: Props = $props();

	let src = $state<string | undefined>(undefined);

	$effect(() => {
		// Base64 takes precedence — no cleanup needed for data URIs
		if (base64 && mediaType) {
			src = `data:${mediaType};base64,${base64}`;
			return;
		}

		// Handle Uint8Array — object URLs must be revoked to avoid memory leaks
		if (uint8Array && mediaType) {
			const blob = new Blob([uint8Array as BlobPart], { type: mediaType });
			const objectUrl = URL.createObjectURL(blob);
			src = objectUrl;

			return () => {
				URL.revokeObjectURL(objectUrl);
			};
		}

		src = undefined;
	});
</script>

{#if !src}
	<div
		aria-label={alt}
		role="img"
		class={cn(
			'h-auto max-w-full animate-pulse overflow-hidden rounded-md bg-gray-100 dark:bg-zinc-800',
			className
		)}
	></div>
{:else}
	<img
		{src}
		{alt}
		class={cn('h-auto max-w-full overflow-hidden rounded-md', className)}
		{...props}
	/>
{/if}
