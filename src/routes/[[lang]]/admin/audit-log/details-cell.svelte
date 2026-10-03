<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import TruncatedText from '$lib/components/truncated-text.svelte';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';
	import { formatDuration } from '$lib/utils/format-duration';

	interface Props {
		metadata: AuditLogItem['metadata'];
		lang: string;
		testId?: string;
	}

	let { metadata, lang, testId }: Props = $props();

	const { t } = getTranslate();

	// Reads `$t` inside the derivation so a language switch updates the translated prefix
	// together with the locale-formatted duration.
	const details = $derived.by(() => {
		if (metadata && 'reason' in metadata && metadata.reason) return metadata.reason;
		if (metadata && 'newRole' in metadata) {
			return $t('admin.audit_log.details.role_change', {
				previousRole: metadata.previousRole,
				newRole: metadata.newRole
			});
		}
		if (metadata && 'durationMs' in metadata) {
			return $t('admin.audit_log.details.impersonation_duration', {
				duration: formatDuration(metadata.durationMs, lang)
			});
		}
		return undefined;
	});
</script>

<div class="min-w-0 text-sm" data-testid={testId}>
	<TruncatedText
		text={details ?? '-'}
		class={details ? 'text-muted-foreground' : 'text-muted-foreground/50'}
	/>
</div>
