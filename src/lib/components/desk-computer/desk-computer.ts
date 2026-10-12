/**
 * Behaviour of the decorative desk computer figure, ported from the live script of
 * anatomy's examples/desk-computer/build.mjs (MIT, see desk-computer.svg).
 *
 * The figure types the saas-starter CLI phrases for at most two loops, then rests on
 * the first one. Clicking a key types it, clicking the case toggles the power. The
 * frame loop runs only while something moves and pauses off-screen.
 */

// Key codes in the order of the figure's `data-key` indices, row by row.
const KEYS = [
	['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'],
	['Tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
	['CapsLock', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'Enter'],
	['Shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'ShiftRight'],
	['Alt', 'Meta', ' ', 'NumpadEnter', 'AltRight']
].flat();
const PHRASES = ['bun create saas-starter', 'cd my-app', 'bun run dev'];
const MAX_CHARS = 24;
// Screen-space constants of the generated figure: the CRT's vertical centre and the
// prompt's left edge, both in the glass plane's units.
const CRT_MID = 113.5;
const TEXT_X = -34;
// How far a pressed key travels, in figure units.
const KEY_TRAVEL = 2.2;
// Screen direction of one unit down the z axis, axisVector(P, [0, 0, -1]) for the
// figure's projection (azimuth 56, elevation 30, scale 1.0030616263933012).
const DOWN: readonly [number, number] = [0, 1.0987989586868707];
const TOUR_LOOPS = 2;
// The cursor keeps blinking this long after a click, then holds still.
const BLINK_AFTER_CLICK_MS = 4000;
const RESUME_AFTER_MS = 9000;

type TourStep = 'type' | 'erase' | 'off' | 'on';
type Tour = { phrase: number; step: TourStep; index: number; wait: number };

const freshTour = (): Tour => ({ phrase: 0, step: 'type', index: 0, wait: 1.4 });
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function missing(selector: string): never {
	throw new Error(`Desk computer part ${selector} missing`);
}

function part(svg: SVGSVGElement, selector: string): SVGElement {
	const element = svg.querySelector(selector);
	return element instanceof SVGElement ? element : missing(selector);
}

/** Starts the figure's tour and pointer interaction; returns the cleanup. */
export function animateDeskComputer(svg: SVGSVGElement): () => void {
	const keyEls = KEYS.map((_, index) => part(svg, `[data-key="${index}"]`));
	const textEl = svg.querySelector('text') ?? missing('text');
	const cursor = part(svg, '[data-part="cursor"]');
	const crt = part(svg, '[data-part="crt"]');
	const beam = part(svg, '[data-part="beam"]');
	const dot = part(svg, '[data-part="dot"]');
	const glass = part(svg, '.pc-glass');
	const led = part(svg, '[data-part="led"]');
	const rockerOn = part(svg, '[data-rocker="on"]');
	const rockerOff = part(svg, '[data-rocker="off"]');
	// Read once, then follow change events: Chromium refreshes a query's cached value on
	// every `matches` read, so polling it per frame would swallow the change event.
	const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
	let still = motionQuery.matches;

	const keyState = KEYS.map(() => ({ at: 0, held: 0 }));
	const active = new Set<number>();
	let line = still ? PHRASES[0]! : '';
	let power = true;
	let powerClock = 9;
	let frame = 0;
	let previous = 0;
	let visible = false;
	let touring = !still;
	let loops = 0;
	let tour = freshTour();
	let clickedRecently = false;
	let resumeTimer: ReturnType<typeof setTimeout> | undefined;
	let blinkTimer: ReturnType<typeof setTimeout> | undefined;

	function syncBlink() {
		cursor.toggleAttribute('data-blink', !still && (touring || clickedRecently));
	}

	function press(code: string, hold = 0.09) {
		const index = KEYS.indexOf(code);
		if (index < 0) return;
		keyState[index]!.held = hold;
		active.add(index);
		run();
	}

	function type(char: string) {
		if (!power || !KEYS.includes(char)) return;
		press(char);
		if (line.length < MAX_CHARS) line += char;
		write();
	}

	function erase() {
		if (!power) return;
		press('Backspace');
		line = line.slice(0, -1);
		write();
	}

	function enter() {
		if (!power) return;
		press('Enter');
		line = '';
		write();
	}

	function write() {
		textEl.textContent = `> ${line}`;
		cursor.setAttribute('x', String(TEXT_X + textEl.getComputedTextLength() + 0.4));
	}

	function setPower(next: boolean) {
		if (next === power) return;
		power = next;
		powerClock = still ? 9 : 0;
		rockerOn.style.display = power ? '' : 'none';
		rockerOff.style.display = power ? 'none' : '';
		led.style.opacity = power ? '' : '0.15';
		write();
		run();
	}

	// Collapses the picture to a line and a dot on power off, and back on power on.
	function crtFrame() {
		const t = powerClock;
		let sx = 1;
		let sy = 1;
		let beamAt = 0;
		let dotAt = 0;
		let lit = power;
		if (power) {
			if (t < 0.14) {
				sx = ease(t / 0.14);
				sy = 0.012;
				beamAt = 1;
			} else if (t < 0.36) {
				sy = 0.012 + 0.988 * ease((t - 0.14) / 0.22);
				beamAt = 1 - ease((t - 0.14) / 0.22);
			}
		} else if (t < 0.1) {
			sy = 1 - 0.988 * ease(t / 0.1);
			beamAt = ease(t / 0.1);
			lit = true;
		} else if (t < 0.26) {
			sy = 0.012;
			sx = 1 - ease((t - 0.1) / 0.16);
			beamAt = 1;
			lit = true;
		} else {
			sx = 0;
			sy = 0;
			dotAt = Math.max(0, 1 - (t - 0.26) / 0.5);
		}
		crt.setAttribute(
			'transform',
			`translate(0 ${-CRT_MID}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(0 ${CRT_MID})`
		);
		beam.setAttribute(
			'transform',
			`translate(0 ${-CRT_MID}) scale(${Math.max(sx, 0.001).toFixed(3)} 1) translate(0 ${CRT_MID})`
		);
		beam.style.opacity = beamAt.toFixed(2);
		dot.style.opacity = dotAt.toFixed(2);
		glass.toggleAttribute('data-on', lit);
		return t > 0.8;
	}

	function stopTour() {
		touring = false;
		syncBlink();
	}

	function tourStep(dt: number) {
		tour.wait -= dt;
		if (tour.wait > 0) return;
		const phrase = PHRASES[tour.phrase]!;
		if (tour.step === 'type') {
			if (tour.index < phrase.length) {
				const char = phrase[tour.index++]!;
				type(char);
				tour.wait = 0.09 + Math.random() * 0.11 + (char === ' ' ? 0.08 : 0);
			} else if (tour.phrase === 0 && loops >= TOUR_LOOPS) {
				// Rest on the first command once the loops are spent.
				stopTour();
			} else {
				tour.step = 'erase';
				tour.wait = 2.4;
			}
		} else if (tour.step === 'erase') {
			if (line.length) {
				erase();
				tour.wait = 0.055;
			} else if (tour.phrase === PHRASES.length - 1) {
				tour.step = 'off';
				tour.wait = 0.9;
			} else {
				tour = { phrase: tour.phrase + 1, step: 'type', index: 0, wait: 0.7 };
			}
		} else if (tour.step === 'off') {
			setPower(false);
			tour.step = 'on';
			tour.wait = 1.6;
		} else {
			setPower(true);
			loops++;
			tour = freshTour();
		}
	}

	function tick(now: number) {
		const dt = previous ? Math.min((now - previous) / 1000, 1 / 30) : 1 / 60;
		previous = now;
		const calm = still;
		if (touring) tourStep(dt);
		powerClock += dt;
		const settledCrt = crtFrame();
		for (const index of active) {
			const state = keyState[index]!;
			state.held = Math.max(0, state.held - dt);
			const want = state.held > 0 ? KEY_TRAVEL : 0;
			state.at = calm
				? want
				: state.at + (want - state.at) * (1 - Math.exp(-dt / (want ? 0.025 : 0.07)));
			if (Math.abs(want - state.at) < 0.01) state.at = want;
			const key = keyEls[index]!;
			key.setAttribute(
				'transform',
				`translate(${(DOWN[0] * state.at).toFixed(2)} ${(DOWN[1] * state.at).toFixed(2)})`
			);
			key.toggleAttribute('data-down', state.at > 0.6);
			if (!state.held && state.at === 0) active.delete(index);
		}
		const busy = touring || active.size > 0 || !settledCrt;
		frame = visible && busy ? requestAnimationFrame(tick) : 0;
	}

	function run() {
		if (frame || !visible) return;
		previous = 0;
		frame = requestAnimationFrame(tick);
	}

	// A click ends the tour; after a quiet spell it types the first command again and rests.
	function takeOver(switching = false) {
		if (touring) {
			touring = false;
			tour = freshTour();
			line = '';
			if (!switching) setPower(true);
			write();
		}
		clickedRecently = true;
		syncBlink();
		clearTimeout(blinkTimer);
		blinkTimer = setTimeout(() => {
			clickedRecently = false;
			syncBlink();
		}, BLINK_AFTER_CLICK_MS);
		clearTimeout(resumeTimer);
		resumeTimer = setTimeout(() => {
			if (still) return;
			touring = true;
			tour = freshTour();
			line = '';
			setPower(true);
			write();
			syncBlink();
			run();
		}, RESUME_AFTER_MS);
	}

	function onClick(event: MouseEvent) {
		if (!(event.target instanceof Element)) return;
		const key = event.target.closest('[data-key]');
		if (key) {
			takeOver();
			const code = KEYS[Number(key.getAttribute('data-key'))];
			if (code === undefined) return;
			if (code.length === 1) type(code);
			else if (code === 'Backspace') erase();
			else if (code === 'Enter' || code === 'NumpadEnter') enter();
			else press(code);
			return;
		}
		if (event.target.closest('[data-part="computer"]')) {
			takeOver(true);
			setPower(!power);
		}
	}

	// Turning reduced motion on mid-tour settles the figure on the first command at once.
	function onMotionPreference(event: MediaQueryListEvent) {
		still = event.matches;
		if (!still) return;
		touring = false;
		clickedRecently = false;
		clearTimeout(resumeTimer);
		clearTimeout(blinkTimer);
		tour = freshTour();
		line = PHRASES[0]!;
		setPower(true);
		powerClock = 9;
		write();
		syncBlink();
		run();
	}

	const observer = new IntersectionObserver(
		(entries) => {
			visible = entries.at(-1)?.isIntersecting ?? false;
			if (visible) run();
		},
		{ rootMargin: '120px 0px' }
	);
	observer.observe(svg);
	svg.addEventListener('click', onClick);
	motionQuery.addEventListener('change', onMotionPreference);
	write();
	crtFrame();
	syncBlink();

	return () => {
		observer.disconnect();
		svg.removeEventListener('click', onClick);
		motionQuery.removeEventListener('change', onMotionPreference);
		cancelAnimationFrame(frame);
		frame = 0;
		clearTimeout(resumeTimer);
		clearTimeout(blinkTimer);
	};
}
