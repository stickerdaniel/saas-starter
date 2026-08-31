import type { Attachment } from 'svelte/attachments';

const DEFAULT_GAP_MS = 60;
const MIN_GAP_MS = 12;
const MAX_AHEAD_MS = 900;
const INITIAL_SPREAD_MS = 400;
const ANIMATION_DURATION_MS = 350;
const PACED_SPAN_SELECTOR = 'span[data-stream-paced], span[style*="animation-name: sd-"]';

export interface StreamingPaceState {
	horizon: number;
	initialized: boolean;
}

export interface StreamingPacePlan {
	delays: number[];
	horizon: number;
}

/**
 * Spread a newly inserted word batch without letting presentation drift far
 * behind the Convex snapshot that supplied it.
 */
export function planStreamingBatch(
	state: StreamingPaceState,
	wordCount: number,
	now: number,
	maxGapMs = DEFAULT_GAP_MS
): StreamingPacePlan {
	if (wordCount <= 0) return { delays: [], horizon: Math.max(state.horizon, now) };

	if (!state.initialized) {
		const gap = wordCount === 1 ? 0 : Math.min(maxGapMs, INITIAL_SPREAD_MS / (wordCount - 1));
		const delays = Array.from({ length: wordCount }, (_, index) => index * gap);
		return {
			delays,
			horizon: now + Math.min(INITIAL_SPREAD_MS, wordCount * gap)
		};
	}

	const ahead = Math.min(MAX_AHEAD_MS, Math.max(0, state.horizon - now));
	const available = Math.max(0, MAX_AHEAD_MS - ahead);
	const gap = Math.min(maxGapMs, Math.max(MIN_GAP_MS, available / wordCount));
	const delays = Array.from({ length: wordCount }, (_, index) =>
		Math.min(MAX_AHEAD_MS, ahead + index * gap)
	);
	return {
		delays,
		horizon: now + Math.min(MAX_AHEAD_MS, ahead + wordCount * gap)
	};
}

interface PacedToken {
	span: HTMLSpanElement;
	text: string;
}

function groupTokensByWord(tokens: PacedToken[]): PacedToken[][] {
	const groups: PacedToken[][] = [];
	let leadingWhitespace: PacedToken[] = [];

	for (const token of tokens) {
		if (/^\s+$/.test(token.text)) {
			if (groups.length > 0) groups.at(-1)!.push(token);
			else leadingWhitespace.push(token);
			continue;
		}

		groups.push([...leadingWhitespace, token]);
		leadingWhitespace = [];
	}

	if (leadingWhitespace.length > 0) {
		if (groups.length > 0) groups.at(-1)!.push(...leadingWhitespace);
		else groups.push(leadingWhitespace);
	}

	return groups;
}

function suppressAnimation(span: HTMLSpanElement) {
	span.style.setProperty('animation', 'none', 'important');
	span.dataset.streamPaced = 'settled';
}

/**
 * Pace Streamdown's real word spans while leaving markdown parsing and layout
 * on the dependency's normal one-render-per-snapshot path.
 */
export function paceStreamingText(
	isStreaming: () => boolean,
	setPresentationActive: (active: boolean) => void
): Attachment<HTMLElement> {
	return (root) => {
		const state: StreamingPaceState = { horizon: 0, initialized: false };
		const configuredGap = Number.parseFloat(
			getComputedStyle(root).getPropertyValue('--stream-gap')
		);
		const maxGapMs = Number.isFinite(configuredGap) ? configuredGap : DEFAULT_GAP_MS;
		let revealedChars = 0;
		let drainTimer: number | undefined;
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

		function clearDrainTimer() {
			if (drainTimer !== undefined) window.clearTimeout(drainTimer);
			drainTimer = undefined;
		}

		function scheduleDrain() {
			clearDrainTimer();
			if (isStreaming()) return;

			const remaining =
				reducedMotion.matches || !state.initialized
					? 0
					: Math.max(0, state.horizon - performance.now()) + ANIMATION_DURATION_MS;
			drainTimer = window.setTimeout(() => {
				if (!isStreaming()) setPresentationActive(false);
			}, remaining);
		}

		function paceAddedSpans() {
			const spans = Array.from(root.querySelectorAll<HTMLSpanElement>(PACED_SPAN_SELECTOR));
			if (spans.length === 0) {
				scheduleDrain();
				return;
			}

			let offset = 0;
			const freshTokens: PacedToken[] = [];
			for (const span of spans) {
				const text = span.textContent ?? '';
				offset += text.length;
				if (span.dataset.streamPaced) continue;
				if (offset <= revealedChars || reducedMotion.matches) suppressAnimation(span);
				else freshTokens.push({ span, text });
			}

			if (freshTokens.length > 0) {
				const groups = groupTokensByWord(freshTokens);
				const now = performance.now();
				const plan = planStreamingBatch(state, groups.length, now, maxGapMs);
				for (const [index, group] of groups.entries()) {
					for (const token of group) {
						token.span.style.setProperty('animation-delay', `${plan.delays[index]}ms`, 'important');
						token.span.dataset.streamPaced = 'scheduled';
					}
				}
				state.horizon = plan.horizon;
				state.initialized = true;
			}

			// MutationObserver runs after Svelte has applied the complete DOM update.
			// Accepting a shorter total keeps the offset aligned when incomplete
			// markdown markers disappear as their final element is materialized.
			revealedChars = offset;
			scheduleDrain();
		}

		const observer = new MutationObserver(paceAddedSpans);
		observer.observe(root, { childList: true, subtree: true });
		queueMicrotask(paceAddedSpans);

		$effect(() => {
			if (isStreaming()) {
				clearDrainTimer();
				setPresentationActive(true);
			} else {
				queueMicrotask(scheduleDrain);
			}
		});

		return () => {
			observer.disconnect();
			clearDrainTimer();
		};
	};
}
