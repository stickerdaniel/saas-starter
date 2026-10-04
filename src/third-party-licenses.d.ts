// Ambient script: no top-level import or export, or this would augment instead of declare.
// Resolved by scripts/third-party-licenses; null in dev, where no build collected notices.
declare module 'virtual:third-party-licenses/server' {
	import type { Catalogue } from '$lib/licenses/catalogue';

	const catalogue: Catalogue | null;
	export default catalogue;
}
