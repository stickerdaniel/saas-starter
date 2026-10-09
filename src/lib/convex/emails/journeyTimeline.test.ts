import { describe, expect, it } from 'vitest';
import type { JourneyStep } from '../admin/journey/source';
import { buildJourneyTimeline, type RailTheme } from './journeyTimeline';

// One distinct colour per role, so each assertion names the role it reads.
const THEME: RailTheme = {
	tones: {
		neutral: { dot: { color: '#000001', darkClass: 'dot-neutral' }, title: null },
		paid: { dot: { color: '#000002' }, title: { color: '#000012', darkClass: 'title-paid' } },
		problem: { dot: { color: '#000003' }, title: null },
		canceled: {
			dot: { color: '#000004' },
			title: { color: '#000014', darkClass: 'title-canceled' }
		}
	},
	line: { color: '#000020', darkClass: 'line' },
	muted: { color: '#000030', darkClass: 'muted' },
	gap: { color: '#000040', darkClass: 'gap' }
};

const rgb = (hex: string) => {
	const value = Number.parseInt(hex.slice(1), 16);
	return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
};

const SIGNUP = Date.UTC(2026, 9, 6, 9, 12);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const STEPS: JourneyStep[] = [
	{ key: 'signup:signed_up', at: SIGNUP, title: 'Signed up', lines: [], tone: 'neutral' },
	{
		key: 'aiChat:before',
		at: SIGNUP + 6 * MINUTE,
		title: 'Sent 14 AI chat messages',
		lines: ['First 09:18, last Thu, Oct 8, 13:55'],
		tone: 'neutral'
	},
	{
		key: 'support:before',
		at: SIGNUP + 2 * 24 * HOUR + 53 * MINUTE,
		title: 'First recorded support contact',
		lines: [],
		tone: 'problem'
	},
	{
		key: 'paid:paid',
		at: SIGNUP + 2 * 24 * HOUR + 5 * HOUR + 18 * MINUTE,
		title: 'Paid $10.00',
		lines: ['Pro, monthly'],
		tone: 'paid'
	},
	{
		key: 'canceled:canceled',
		at: SIGNUP + 14 * 24 * HOUR,
		title: 'Canceled',
		lines: ['Access until Sat, Nov 8'],
		tone: 'canceled'
	}
];

const FORMAT = { locale: 'en', timeZone: 'UTC' } as const;

function render(steps: readonly JourneyStep[], notes: string[] = []) {
	const { html, text } = buildJourneyTimeline(steps, notes, FORMAT, THEME);
	const root = document.createElement('div');
	root.innerHTML = html;
	return { root, text };
}

/** The innermost element whose whole text is `text`. */
function element(root: HTMLElement, text: string): HTMLElement {
	const found = [...root.querySelectorAll<HTMLElement>('*')].filter(
		(candidate) => candidate.textContent === text
	);
	const innermost = found[found.length - 1];
	if (!innermost) throw new Error(`No element reads "${text}"`);
	return innermost;
}

function painted(root: HTMLElement, property: 'color' | 'backgroundColor', hex: string) {
	return [...root.querySelectorAll<HTMLElement>('*')].filter(
		(candidate) => candidate.style[property] === rgb(hex)
	);
}

describe('buildJourneyTimeline', () => {
	it('paints dots and titles from the tone roles, and lets a null title inherit', () => {
		const { root } = render(STEPS);

		expect(painted(root, 'backgroundColor', '#000001')).toHaveLength(2);
		expect(painted(root, 'backgroundColor', '#000003')).toHaveLength(1);
		expect(painted(root, 'backgroundColor', '#000002')).toHaveLength(1);
		expect(painted(root, 'backgroundColor', '#000004')).toHaveLength(1);
		for (const dot of painted(root, 'backgroundColor', '#000001')) {
			expect(dot.classList).toContain('dot-neutral');
		}

		const paid = element(root, 'Paid $10.00');
		expect(paid.style.color).toBe(rgb('#000012'));
		expect(paid.classList).toContain('title-paid');
		const canceled = element(root, 'Canceled');
		expect(canceled.style.color).toBe(rgb('#000014'));
		expect(canceled.classList).toContain('title-canceled');
		expect(element(root, 'Signed up').style.color).toBe('');
		expect(element(root, 'First recorded support contact').style.color).toBe('');

		for (const muted of [element(root, 'Pro, monthly'), element(root, '14:30')]) {
			expect(muted.style.color).toBe(rgb('#000030'));
			expect(muted.classList).toContain('muted');
		}
		const line = painted(root, 'backgroundColor', '#000020');
		expect(line.length).toBeGreaterThan(0);
		for (const segment of line) expect(segment.classList).toContain('line');
	});

	it('shows the date only when the local day changes from the step before', () => {
		const { root } = render(STEPS);
		expect(element(root, 'Tue, Oct 6, 09:12')).toBeTruthy();
		expect(element(root, '09:18')).toBeTruthy();
		expect(element(root, 'Thu, Oct 8, 10:05')).toBeTruthy();
		expect(element(root, '14:30')).toBeTruthy();
		expect(element(root, 'Tue, Oct 20, 09:12')).toBeTruthy();
	});

	it('places each gap label after the previous step and directly before the next', () => {
		const { root } = render(STEPS);
		const order = (text: string) => root.textContent!.indexOf(text);
		const gap = element(root, '6 min later');
		expect(gap.style.color).toBe(rgb('#000040'));
		expect(gap.classList).toContain('gap');

		expect(order('Signed up')).toBeLessThan(order('6 min later'));
		expect(order('6 min later')).toBeLessThan(order('Sent 14 AI chat messages'));
		// Below the previous step's details, not above them.
		expect(order('First 09:18, last Thu, Oct 8, 13:55')).toBeLessThan(order('2 d later'));
		expect(order('2 d later')).toBeLessThan(order('First recorded support contact'));
		expect(order('Access until Sat, Nov 8')).toBe(
			root.textContent!.length - 'Access until Sat, Nov 8'.length
		);
		expect(root.textContent!.match(/later/g)).toHaveLength(STEPS.length - 1);
	});

	it('escapes every string in the HTML and keeps the text version raw', () => {
		const hostile = '<img src=x onerror="alert(1)"> & \'quoted\'';
		const { root, text } = render(
			[{ key: 'x:y', at: SIGNUP, title: hostile, lines: [hostile], tone: 'neutral' }],
			[hostile]
		);

		expect(root.querySelector('img')).toBeNull();
		expect(
			[...root.querySelectorAll('*')].filter((node) => node.textContent === hostile)
		).not.toHaveLength(0);
		expect(text).toBe(`${hostile} (Tue, Oct 6, 09:12)\n  ${hostile}\n\n${hostile}`);
	});

	it('writes the text version from the same steps, gaps and notes', () => {
		const { text } = render(STEPS.slice(0, 2), ['AI chat messages: recorded since Tue, Oct 6.']);
		expect(text).toBe(
			[
				'Signed up (Tue, Oct 6, 09:12)',
				'',
				'6 min later',
				'Sent 14 AI chat messages (09:18)',
				'  First 09:18, last Thu, Oct 8, 13:55',
				'',
				'AI chat messages: recorded since Tue, Oct 6.'
			].join('\n')
		);
	});
});
