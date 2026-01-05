<script lang="ts">
	import { Section, Row, Column, Img, Text } from 'better-svelte-email/components';
	import { cn } from '$lib/utils.js';
	import { emailBaseUrl } from '$lib/emails/config.js';

	let {
		appName = 'SaaS Starter',
		class: className
	}: {
		appName?: string;
		class?: string;
	} = $props();
</script>

<Section class={cn('mb-8', className)}>
	<Row>
		<Column align="left" class="px-6">
			<Img
				src="{emailBaseUrl}/logo.png"
				width="28"
				height="28"
				alt="SaaS Starter Logo"
				class="my-0 mr-2 inline-block align-middle"
			/>
			<Text class="my-0 inline-block align-middle text-[20px] font-bold text-black">
				{appName}
			</Text>
		</Column>
	</Row>
</Section>
