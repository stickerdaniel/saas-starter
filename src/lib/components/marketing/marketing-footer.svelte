<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/button/button.svelte';
	import { LEGAL_CONFIG } from '$lib/config/legal';
	import { analyticsPreferencesContext } from '$lib/analytics/preferences.svelte.ts';

	const analyticsPreferences = analyticsPreferencesContext.get();
</script>

<footer class="mt-auto pt-24">
	<div class="mx-auto max-w-6xl px-6 lg:px-12">
		<div
			class="-mx-2 w-[calc(100%+1rem)] rounded-t-2xl border-t marketing-shell-panel-footer marketing-footer-mask px-8 pt-8 pb-32 lg:-mx-8 lg:w-[calc(100%+4rem)] lg:px-8"
		>
			<div class="flex items-start justify-between sm:items-center">
				<p class="text-xs text-muted-foreground">
					<T
						keyName="footer.copyright"
						params={{
							year: new Date().getFullYear().toString(),
							brand: LEGAL_CONFIG.brandName
						}}
					/>
				</p>
				<nav
					class="flex flex-col items-end gap-0 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-1"
				>
					<Button variant="ghost-muted" size="footer" href={resolve(localizedHref('/impressum'))}>
						<T keyName="footer.impressum" />
					</Button>
					<span class="hidden sm:inline" aria-hidden="true">&middot;</span>
					<Button variant="ghost-muted" size="footer" href={resolve(localizedHref('/terms'))}>
						<T keyName="footer.terms" />
					</Button>
					<span class="hidden sm:inline" aria-hidden="true">&middot;</span>
					<Button variant="ghost-muted" size="footer" href={resolve(localizedHref('/privacy'))}>
						<T keyName="footer.privacy" />
					</Button>
					<span class="hidden sm:inline" aria-hidden="true">&middot;</span>
					<Button variant="ghost-muted" size="footer" href={resolve(localizedHref('/licenses'))}>
						<T keyName="footer.licenses" />
					</Button>
					{#if analyticsPreferences.state.enabled}
						<span class="hidden sm:inline" aria-hidden="true">&middot;</span>
						<Button variant="ghost-muted" size="footer" onclick={() => analyticsPreferences.open()}>
							<T keyName="footer.privacy_settings" />
						</Button>
					{/if}
				</nav>
			</div>
		</div>
	</div>
</footer>
