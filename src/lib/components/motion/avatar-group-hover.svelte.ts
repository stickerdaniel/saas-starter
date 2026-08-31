import { motionEase, motionValue } from './motion-tokens.js';

/**
 * Distance-falloff hover lift for a horizontal row of items.
 *
 * Apply to the row; every descendant carrying `t-avatar` joins the group. The
 * hovered item lifts and scales, its neighbours lift by a power falloff, and
 * the whole row springs back on the way out.
 *
 * Presentation only. It binds no click handler and sets no cursor, so a row
 * the user cannot act on does not start advertising that they can.
 */
export function avatarGroupHover(node: HTMLElement) {
	let items: HTMLElement[] = [];

	function setShifts(activeIndex: number | null, phase: 'in' | 'out') {
		const lift = motionValue('--avatar-lift', -4);
		const falloff = motionValue('--avatar-falloff', 0.45);
		const scale = motionValue('--avatar-scale', 1.05);
		const timing =
			phase === 'out'
				? motionEase('--avatar-ease-out', 'cubic-bezier(0.34, 3.85, 0.64, 1)')
				: motionEase('--avatar-ease-in', 'cubic-bezier(0.22, 1, 0.36, 1)');

		for (const [i, item] of items.entries()) {
			// The timing function has to be written before the variables: a
			// transition picks up whichever function is current at the moment the
			// property changes, and that is what gives the return leg its bounce
			// without a second declaration for the leaving state.
			item.style.transitionTimingFunction = timing;
			if (activeIndex === null) {
				item.style.setProperty('--shift', '0px');
				item.style.setProperty('--scale-active', '1');
				continue;
			}
			const distance = Math.abs(i - activeIndex);
			item.style.setProperty('--shift', `${(lift * falloff ** distance).toFixed(3)}px`);
			item.style.setProperty('--scale-active', i === activeIndex ? String(scale) : '1');
		}
	}

	const enter = (event: Event) => {
		const index = items.indexOf(event.currentTarget as HTMLElement);
		if (index !== -1) setShifts(index, 'in');
	};
	const leave = () => setShifts(null, 'out');

	function bind() {
		for (const item of items) item.removeEventListener('mouseenter', enter);
		items = Array.from(node.querySelectorAll<HTMLElement>('.t-avatar'));
		for (const item of items) item.addEventListener('mouseenter', enter);
	}

	bind();
	node.addEventListener('mouseleave', leave);
	// The row is built from a query result, so items arriving later (an async
	// avatar list, a conditional slot) would otherwise never be wired up.
	const observer = new MutationObserver(bind);
	observer.observe(node, { childList: true, subtree: true });

	return {
		destroy() {
			observer.disconnect();
			for (const item of items) item.removeEventListener('mouseenter', enter);
			node.removeEventListener('mouseleave', leave);
		}
	};
}
