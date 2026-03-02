<script lang="ts">
	import type { FieldDefinition } from '$lib/admin/types';
	import { Separator } from '$lib/components/ui/separator/index.js';

	type Props = {
		field: FieldDefinition<any>;
	};

	let { field: _field }: Props = $props();
</script>

<div class="py-2">
	<Separator />
</div>
