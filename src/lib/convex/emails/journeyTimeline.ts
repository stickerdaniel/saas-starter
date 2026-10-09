import { t } from '../i18n/translations';
import { createClock, formatDuration, type JourneyFormat } from '../admin/journey/format';
import type { JourneyStep, JourneyTone } from '../admin/journey/source';
import { escapeHtml } from './html';

/**
 * Builds the journey rail of the admin customer emails, once as HTML for a
 * template's `timelineHtml` placeholder and once as plain text for the text
 * version, from the same ordered steps.
 *
 * Layout: each step is three table rows beside a 22 px rail column.
 * 1. The head row has a fixed height and holds the dot, with the line above it.
 *    The title and time cell spans this row and the next.
 * 2. The stretch row holds only the 2 px line, as a cell background. A wrapped
 *    title or time makes the spanning cell taller than the fixed head row, and
 *    table layout gives that extra height to this auto-height row, so the line
 *    runs on below the dot instead of breaking (checked in Chromium and
 *    WebKit; percentage heights inside the rail did not stretch).
 * 3. The detail row holds the step's lines and, at its foot, the gap label of
 *    the next step, with the line continuing beside it.
 *
 * Colours are inline from the theme; a role's `darkClass` carries only the
 * dark-scheme override, which the consuming template defines in its head.
 */

/** One colour the rail paints, with the class that overrides it in dark mode. */
export type RailRole = { color: string; darkClass?: string };

/**
 * The roles the rail consumes. Per tone a dot and a title colour; a null title
 * inherits the body text colour. `line` is the rail, `muted` details and
 * times, `gap` the "3 h later" labels.
 */
export type RailTheme = {
	tones: Record<JourneyTone, { dot: RailRole; title: RailRole | null }>;
	line: RailRole;
	muted: RailRole;
	gap: RailRole;
};

const TABLE = 'cellpadding="0" cellspacing="0" border="0" role="presentation"';

/** Height of the head row: the line above the dot, then the dot. */
const SEGMENT_PX = 5;
const DOT_PX = 10;

/** Inline style text from a property map. */
function css(properties: Record<string, string>): string {
	return Object.entries(properties)
		.map(([property, value]) => `${property}:${value}`)
		.join(';');
}

/** ` class="…" style="…"` for a role painted as `property`. */
function paint(role: RailRole | null, property: string, base: Record<string, string>): string {
	const className = role?.darkClass ? ` class="${escapeHtml(role.darkClass)}"` : '';
	const style = css(role ? { ...base, [property]: role.color } : base);
	return `${className} style="${escapeHtml(style)}"`;
}

function paragraph(text: string, role: RailRole, properties: Record<string, string>): string {
	return `<p${paint(role, 'color', { margin: '0', ...properties })}>${escapeHtml(text)}</p>`;
}

/** The 10 px side cells and the 2 px line cell between them. */
function railCells(theme: RailTheme, line: boolean, content = ''): string {
	const side = '<td width="10" style="width:10px;font-size:0;line-height:0"></td>';
	const middle = `<td width="2"${paint(line ? theme.line : null, 'background-color', {
		width: '2px',
		'font-size': '0',
		'line-height': '0'
	})}>${content}</td>`;
	return `${side}${middle}${side}`;
}

/**
 * The timeline as HTML and as plain text. `steps` arrive in display order;
 * each time is shown relative to the step before it, so the date appears only
 * when the local day changes. `notes` follow the rail as muted lines. Every
 * string is escaped in the HTML; the text carries no markup or entities.
 */
export function buildJourneyTimeline(
	steps: readonly JourneyStep[],
	notes: readonly string[],
	format: JourneyFormat,
	theme: RailTheme
): { html: string; text: string } {
	const { locale } = format;
	const clock = createClock(format);
	const timed = steps.map((step, index) => {
		const previous = steps[index - 1];
		return {
			...step,
			time: clock.time(step.at, previous?.at),
			gap: previous
				? t(locale, 'email.customer_journey.core.later', {
						duration: formatDuration(step.at - previous.at, locale)
					})
				: null
		};
	});

	const rows = timed.map((step, index) => {
		const first = index === 0;
		const last = index === timed.length - 1;
		const next = timed[index + 1];
		const tone = theme.tones[step.tone];
		const segment = `<div${paint(first ? null : theme.line, 'background-color', {
			margin: '0 auto',
			height: `${SEGMENT_PX}px`,
			width: '2px'
		})}></div>`;
		const dot = `<div${paint(tone.dot, 'background-color', {
			margin: '0 auto',
			height: `${DOT_PX}px`,
			width: `${DOT_PX}px`,
			'border-radius': '9999px'
		})}></div>`;
		const head = SEGMENT_PX + DOT_PX;
		const title = `<td${paint(tone.title, 'color', {
			'vertical-align': 'top',
			'font-size': '14px',
			'line-height': '20px',
			'font-weight': '600'
		})}>${escapeHtml(step.title)}</td>`;
		const time = `<td align="right"${paint(theme.muted, 'color', {
			'padding-left': '12px',
			'vertical-align': 'top',
			'font-size': '12px',
			'line-height': '20px',
			'white-space': 'nowrap'
		})}>${escapeHtml(step.time)}</td>`;
		const lines = step.lines
			.map((line) => paragraph(line, theme.muted, { 'font-size': '13px', 'line-height': '20px' }))
			.join('');
		// The gap belongs to the next step, so it sits at the foot of this row,
		// directly above that step.
		const gap = next?.gap
			? paragraph(next.gap, theme.gap, {
					'padding-top': '16px',
					'font-size': '12px',
					'line-height': '20px'
				})
			: '';
		return [
			`<tr style="height:${head}px">`,
			`<td colspan="3" width="22" height="${head}" valign="top" style="height:${head}px;vertical-align:top;font-size:0;line-height:0">`,
			`<table width="22" ${TABLE}><tbody><tr><td>${segment}</td></tr><tr><td>${dot}</td></tr></tbody></table>`,
			'</td>',
			`<td rowspan="2" valign="top" style="padding-left:12px;vertical-align:top">`,
			`<table width="100%" ${TABLE}><tbody><tr>${title}${time}</tr></tbody></table>`,
			'</td>',
			'</tr>',
			`<tr>${railCells(theme, !last, `<div style="height:${SEGMENT_PX}px"></div>`)}</tr>`,
			`<tr>${railCells(theme, !last)}<td valign="top" style="padding-left:12px;vertical-align:top">${lines}${gap}</td></tr>`
		].join('');
	});

	const table = rows.length
		? `<table width="100%" ${TABLE} style="margin-bottom:24px"><tbody>${rows.join('')}</tbody></table>`
		: '';
	const noteHtml = notes.length
		? `<div style="margin-bottom:24px">${notes
				.map((note) => paragraph(note, theme.muted, { 'font-size': '12px', 'line-height': '18px' }))
				.join('')}</div>`
		: '';

	const text = [
		...timed.map((step) =>
			[step.gap, `${step.title} (${step.time})`, ...step.lines.map((line) => `  ${line}`)]
				.filter((line): line is string => line !== null)
				.join('\n')
		),
		...notes
	].join('\n\n');

	return { html: `${table}${noteHtml}`, text };
}
