<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { LoadingBar } from '$lib/components/ui/loading-bar/index.js';
	import { translateFormError } from '$lib/utils/validation-i18n.js';

	type Props = {
		email: string;
		formError: string;
		onBack: () => void;
	};

	let { email, formError, onBack }: Props = $props();

	const { t } = getTranslate();
</script>

<div class="min-h-96">
	<LoadingBar value={100} mode="progress" class="h-1 rounded-none" />
	<div class="flex h-full flex-col justify-center p-6 md:p-8">
		<Field.Group>
			<div class="flex flex-col items-center gap-2 text-center">
				<h1 class="text-2xl font-bold">
					<T keyName="auth.verification.title" />
				</h1>
				<p class="text-balance text-muted-foreground">
					<T keyName="auth.verification.description" />
				</p>
			</div>
			<Field.Field>
				<p class="text-sm text-muted-foreground">
					<T keyName="auth.verification.sent_to" />
					<span class="font-medium">{email}</span>
				</p>
			</Field.Field>
			<Field.Field>
				<p class="text-sm text-muted-foreground">
					<T keyName="auth.verification.check_email" />
				</p>
			</Field.Field>
			{#if formError}
				<Field.Field>
					<Field.Error errors={translateFormError(formError, $t)} />
				</Field.Field>
			{/if}
			<Field.Field>
				<Button type="button" variant="ghost" class="w-full" onclick={onBack}>
					<T keyName="auth.verification.button_back" />
				</Button>
			</Field.Field>
		</Field.Group>
	</div>
</div>
