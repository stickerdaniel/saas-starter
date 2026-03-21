<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { Link } from 'better-svelte-email/components';
	import { Separator } from '$lib/emails/components/ui/index.js';
	import { LEGAL_CONFIG } from '$lib/config/legal';

	const currentYear = new Date().getFullYear();

	let {
		companyName = LEGAL_CONFIG.companyName,
		address = LEGAL_CONFIG.address,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		companyName?: string;
		address?: string;
	} = $props();
</script>

<div class={className} {...restProps}>
	<Separator class="mb-6" />
	<div class="space-y-1 text-left">
		<p class="text-xs text-muted-foreground">
			Copyright © {currentYear}
			<Link href="__BASEURL__/" class="text-muted-foreground underline">{companyName}</Link> All rights
			reserved.
		</p>
		<p class="text-xs text-muted-foreground">{address}</p>
	</div>
</div>
