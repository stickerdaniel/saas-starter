<script lang="ts" module>
	import InfoIcon from '@lucide/svelte/icons/info';
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import MessageSquareWarningIcon from '@lucide/svelte/icons/message-square-warning';
	import OctagonAlertIcon from '@lucide/svelte/icons/octagon-alert';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	export const CALLOUT_ICONS = {
		note: InfoIcon,
		tip: LightbulbIcon,
		important: MessageSquareWarningIcon,
		warning: TriangleAlertIcon,
		caution: OctagonAlertIcon
	};

	export type CalloutKind = keyof typeof CALLOUT_ICONS;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getTranslate } from '@tolgee/svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';

	let { kind, children }: { kind: CalloutKind; children: Snippet } = $props();

	const { t } = getTranslate();
	const Icon = $derived(CALLOUT_ICONS[kind]);
	const titles: Record<CalloutKind, string> = {
		note: 'docs.alert.note',
		tip: 'docs.alert.tip',
		important: 'docs.alert.important',
		warning: 'docs.alert.warning',
		caution: 'docs.alert.caution'
	};
</script>

<Alert.Root role="note" variant="docs" data-kind={kind} class="mt-6 w-auto md:-mx-1">
	<Icon aria-hidden="true" />
	<Alert.Title>{$t(titles[kind])}</Alert.Title>
	<Alert.Description>
		{@render children()}
	</Alert.Description>
</Alert.Root>
