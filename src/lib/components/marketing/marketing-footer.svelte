<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import { resolve } from '$app/paths';
</script>

<footer class="mt-auto pt-24">
	<div class="mx-auto max-w-6xl px-6 lg:px-12">
		<div
			class="-mx-2 w-[calc(100%+1rem)] rounded-t-2xl border-t border-border/50 [mask-image:linear-gradient(to_bottom,black_30%,transparent_100%)] px-8 pt-8 pb-32 [box-shadow:inset_0_1px_1px_0_rgba(255,255,255,0.5)] backdrop-blur-[5px] [background:linear-gradient(137deg,rgba(252,252,255,0.9)_4.87%,rgba(240,240,248,0.95)_75.88%)] lg:-mx-8 lg:w-[calc(100%+4rem)] lg:px-8 dark:[box-shadow:inset_0_1px_1px_0_rgba(255,255,255,0.15)] dark:[background:linear-gradient(137deg,rgba(17,18,20,0.75)_4.87%,rgba(12,13,15,0.9)_75.88%)]"
		>
			<div class="flex items-start justify-between sm:items-center">
				<p class="text-xs text-muted-foreground">
					<T keyName="footer.copyright" params={{ year: new Date().getFullYear().toString() }} />
				</p>
				<nav
					class="flex flex-col items-end gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-3"
				>
					<a
						href={resolve(localizedHref('/impressum'))}
						class="transition-colors duration-150 hover:text-accent-foreground"
					>
						<T keyName="footer.impressum" />
					</a>
					<span class="hidden sm:inline" aria-hidden="true">&middot;</span>
					<a
						href={resolve(localizedHref('/terms'))}
						class="transition-colors duration-150 hover:text-accent-foreground"
					>
						<T keyName="footer.terms" />
					</a>
					<span class="hidden sm:inline" aria-hidden="true">&middot;</span>
					<a
						href={resolve(localizedHref('/privacy'))}
						class="transition-colors duration-150 hover:text-accent-foreground"
					>
						<T keyName="footer.privacy" />
					</a>
				</nav>
			</div>
		</div>
	</div>
</footer>
