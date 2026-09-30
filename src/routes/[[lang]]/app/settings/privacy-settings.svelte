<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { analyticsPreferencesContext } from '$lib/analytics/preferences.svelte.ts';

	const preferences = analyticsPreferencesContext.get();
	const { t } = getTranslate();

	// Bound through a getter so the switch always shows the stored choice, also when
	// the browser refused to store it or another tab changed it.
	function onCheckedChange(checked: boolean): void {
		if (!checked) {
			preferences.decline();
			return;
		}
		if (!preferences.allow()) toast.error($t('analytics.consent.storage_failed'));
	}
</script>

{#if preferences.state.enabled}
	<Card.Root>
		<Card.Header>
			<Card.Title><T keyName="settings.privacy.title" /></Card.Title>
			<Card.Description><T keyName="settings.privacy.description" /></Card.Description>
		</Card.Header>
		<Card.Content>
			<Field.Field orientation="horizontal">
				<Field.Content>
					<Field.Label for="analytics-consent-switch">
						<T keyName="settings.privacy.analytics_label" />
					</Field.Label>
					<Field.Description>
						<T keyName="settings.privacy.analytics_hint" />
					</Field.Description>
				</Field.Content>
				<Switch
					id="analytics-consent-switch"
					bind:checked={() => preferences.state.status === 'granted', onCheckedChange}
				/>
			</Field.Field>
		</Card.Content>
	</Card.Root>
{/if}
