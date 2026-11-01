import { describe, expect, it } from 'vitest';
import {
	insertVariable,
	pasteLink,
	toggleBold,
	toggleLink,
	toggleList,
	type BodyEdit,
	type BodySelection
} from './founder-body-edits';

// Bodies mark the selection with «» and a caret with |.
function parse(marked: string): BodySelection {
	const caret = marked.indexOf('|');
	if (caret !== -1) return { value: marked.replace('|', ''), start: caret, end: caret };
	const start = marked.indexOf('«');
	const end = marked.indexOf('»') - 1;
	return { value: marked.replace('«', '').replace('»', ''), start, end };
}

/** Apply a command to a marked body and mark the selection it leaves. */
function edit(command: (selection: BodySelection) => BodyEdit | undefined, marked: string) {
	const selection = parse(marked);
	const result = command(selection);
	if (!result) return undefined;
	const { value } = selection;
	const next = value.slice(0, result.from) + result.text + value.slice(result.to);
	const [start, end] = result.select;
	if (start === end) return `${next.slice(0, start)}|${next.slice(start)}`;
	return `${next.slice(0, start)}«${next.slice(start, end)}»${next.slice(end)}`;
}

describe('toggleBold', () => {
	it.each([
		['Say «thanks» now', 'Say **«thanks»** now'],
		['Say «thanks »now', 'Say **«thanks»** now'],
		['Say |now', 'Say **|**now'],
		['Say **«thanks»** now', 'Say «thanks» now'],
		['Say «**thanks**» now', 'Say «thanks» now'],
		['Say **tha|nks** now', 'Say «thanks» now'],
		['- «Two»', '- **«Two»**']
	])('turns %s into %s', (body, expected) => {
		expect(edit(toggleBold, body)).toBe(expected);
	});

	it.each([
		'Open [the «app»](https://app.example.com)',
		'Hey {{user«First»Name}}',
		'«- Two»',
		'Say «a\nb»',
		'Say «a*b»'
	])('leaves %s alone', (body) => {
		expect(edit(toggleBold, body)).toBeUndefined();
	});
});

describe('toggleLink', () => {
	it.each([
		['Read «the docs» today', 'Read [the docs](«https://») today'],
		['Read |', 'Read [|](https://)'],
		['Read [the d|ocs](https://docs.example.com) today', 'Read «the docs» today'],
		['Hey «{{userFirstName}}»', 'Hey [{{userFirstName}}](«https://»)']
	])('turns %s into %s', (body, expected) => {
		expect(edit(toggleLink, body)).toBe(expected);
	});

	it.each(['Say **«thanks»**', 'Say «[thanks]»', 'Hey {{user«First»Name}}'])(
		'leaves %s alone',
		(body) => {
			expect(edit(toggleLink, body)).toBeUndefined();
		}
	);
});

describe('pasteLink', () => {
	const paste = (url: string) => (selection: BodySelection) => pasteLink(selection, url);

	it('links the selection to a pasted URL', () => {
		expect(edit(paste(' https://new.example.com '), 'Say «thanks» now')).toBe(
			'Say [thanks](https://new.example.com)| now'
		);
	});

	it.each([
		['Say **«thanks»** for joining', 'https://new.example.com'],
		['Please [«thanks»](https://old.example.com)!', 'https://new.example.com'],
		['Hey {{«userFirstName»}}, welcome', 'https://new.example.com'],
		['1«2». Open the app', 'https://new.example.com'],
		['Say «thanks»', 'javascript:alert(1)'],
		['Say «thanks»', 'https://example.com/a(b)'],
		['Say |thanks', 'https://new.example.com']
	])('pastes normally into %s', (body, url) => {
		expect(edit(paste(url), body)).toBeUndefined();
	});
});

describe('toggleList', () => {
	const bullets = (selection: BodySelection) => toggleList(selection, false);
	const numbers = (selection: BodySelection) => toggleList(selection, true);

	it('marks every selected line and leaves blank lines blank', () => {
		expect(edit(bullets, 'One\n«Two\n\nThree»')).toBe('One\n«- Two\n\n- Three»');
		expect(edit(numbers, '«Two\n\nThree»')).toBe('«1. Two\n\n2. Three»');
	});

	it('removes the markers of a list of the same kind', () => {
		expect(edit(bullets, '«- Two\n- Three»')).toBe('«Two\nThree»');
	});

	it('switches a list to the other kind', () => {
		expect(edit(numbers, '«- Two\n- Three»')).toBe('«1. Two\n2. Three»');
	});

	it('marks the line under the caret and keeps the caret at its end', () => {
		expect(edit(bullets, 'One\nTw|o')).toBe('One\n- Two|');
	});
});

it('inserts a placeholder in place of the selection', () => {
	expect(edit((selection) => insertVariable(selection, 'userFirstName'), 'Hi «you»,')).toBe(
		'Hi {{userFirstName}}|,'
	);
});
