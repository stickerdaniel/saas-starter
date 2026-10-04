<script lang="ts">
	import { getRowSelectionContext } from '../recipients-context';

	const getRowSelection = getRowSelectionContext();
</script>

<output data-testid="context-selection">{Object.keys(getRowSelection()).sort().join(',')}</output>
