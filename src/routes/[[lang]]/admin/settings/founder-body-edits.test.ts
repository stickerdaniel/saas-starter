import { describe, expect, it } from 'vitest';
import {
	bodyFormats,
	continueList,
	insertVariable,
	pasteLink,
	removeListMarker,
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
		['Say **tha|nks** now', 'Say tha|nks now'],
		['Say **thanks|** now', 'Say **thanks**| now'],
		['Say **|** now', 'Say | now'],
		['Say **thanks**|', 'Say **thanks****|**'],
		['Say **thanks****|**', 'Say **thanks**|'],
		['**Say «thanks» now**', '**Say **«thanks»** now**'],
		['**«Say» thanks**', '«Say»** thanks**'],
		['«Say **thanks**» now', '**«Say thanks»** now'],
		['Say **tha«nks** now»', 'Say **«thanks now»**'],
		['- «Two»', '- **«Two»**'],
		['«Alpha\n»Beta', '**«Alpha»**\nBeta']
	])('turns %s into %s', (body, expected) => {
		expect(edit(toggleBold, body)).toBe(expected);
	});

	it.each([
		'Open [the «app»](https://app.example.com)',
		'Hey {{user«First»Name}}',
		'«- Two»',
		'Say «a\nb»',
		'Say «a*b»',
		'*«Thanks» today',
		'«Say [hi](https://hi.example.com)»'
	])('leaves %s alone', (body) => {
		expect(edit(toggleBold, body)).toBeUndefined();
	});
});

describe('toggleLink', () => {
	it.each([
		['Read «the docs» today', 'Read [the docs](«https://») today'],
		['Read |', 'Read [|](https://)'],
		['Read [the d|ocs](https://docs.example.com) today', 'Read the d|ocs today'],
		['Read [the docs](«https://») today', 'Read «the docs» today'],
		['Read [|](https://)', 'Read |'],
		['Hey «{{userFirstName}}»', 'Hey [{{userFirstName}}](«https://»)']
	])('turns %s into %s', (body, expected) => {
		expect(edit(toggleLink, body)).toBe(expected);
	});

	it.each(['Say **«thanks»**', 'Say «[thanks]»', 'Hey {{user«First»Name}}', '!«Thanks» today'])(
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

	it('fills the target a new link selected and leaves the caret after it', () => {
		expect(edit(paste('https://new.example.com'), 'Read [the docs](«https://») today')).toBe(
			'Read [the docs](https://new.example.com)| today'
		);
	});

	it.each([
		['Read [the docs](«https://») today', 'not a url'],
		['Read [the docs](https://«docs».example.com) today', 'https://new.example.com'],
		['Say **«thanks»** for joining', 'https://new.example.com'],
		['Please [«thanks»](https://old.example.com)!', 'https://new.example.com'],
		['Hey {{«userFirstName»}}, welcome', 'https://new.example.com'],
		['1«2». Open the app', 'https://new.example.com'],
		['Say «thanks»', 'javascript:alert(1)'],
		['Say «thanks»', 'https://example.com/a(b)'],
		['!«Thanks» today', 'https://new.example.com'],
		['[«Thanks»] today', 'https://new.example.com'],
		['Say |thanks', 'https://new.example.com']
	])('pastes normally into %s', (body, url) => {
		expect(edit(paste(url), body)).toBeUndefined();
	});
});

describe('toggleList', () => {
	const bullets = (selection: BodySelection) => toggleList(selection, 'bulleted');
	const numbers = (selection: BodySelection) => toggleList(selection, 'numbered');

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

	it('leaves the line after a selection that ends on its newline alone', () => {
		expect(edit(bullets, '«Alpha\n»Beta\nGamma')).toBe('«- Alpha»\nBeta\nGamma');
	});

	it('marks the line under the caret and keeps the caret in its text', () => {
		expect(edit(bullets, 'One\nTw|o')).toBe('One\n- Tw|o');
		expect(edit(bullets, 'One\n- Tw|o')).toBe('One\nTw|o');
	});

	it('starts an item on a blank line and removes it again', () => {
		expect(edit(bullets, 'One\n|')).toBe('One\n- |');
		expect(edit(bullets, 'One\n- |')).toBe('One\n|');
		expect(edit(numbers, '- |')).toBe('1. |');
	});

	it('continues the numbers of the item above', () => {
		expect(edit(numbers, '1. One\n«Two\nThree»')).toBe('1. One\n«2. Two\n3. Three»');
		expect(edit(numbers, '2. Two\n|')).toBe('2. Two\n3. |');
	});

	it('leaves a selection of blank lines alone', () => {
		expect(edit(bullets, 'One\n«\n»\nTwo')).toBeUndefined();
	});
});

describe('continueList', () => {
	it.each([
		['- One|', '- One\n- |'],
		['- O|ne', '- O\n- |ne'],
		['1. One|\n2. Two\n3. Three\n\n1. Other', '1. One\n2. |\n3. Two\n4. Three\n\n1. Other'],
		['- One\n- |', '- One\n|'],
		['1. One\n2. |', '1. One\n|']
	])('turns %s into %s on Enter', (body, expected) => {
		expect(edit(continueList, body)).toBe(expected);
	});

	it.each(['Plain|', '-| One', '- «One»'])('leaves Enter in %s to the textarea', (body) => {
		expect(edit(continueList, body)).toBeUndefined();
	});
});

describe('removeListMarker', () => {
	it.each([
		['- |One', '|One'],
		['12. |One', '|One'],
		['- |', '|']
	])('turns %s into %s on Backspace', (body, expected) => {
		expect(edit(removeListMarker, body)).toBe(expected);
	});

	it.each(['- O|ne', 'Plain|', '-| One'])('leaves Backspace in %s to the textarea', (body) => {
		expect(edit(removeListMarker, body)).toBeUndefined();
	});
});

describe('bodyFormats', () => {
	it.each([
		['Say **tha|nks** now', { bold: true, link: false, list: undefined }],
		['Say |**thanks** now', { bold: false, link: false, list: undefined }],
		['Say **|**', { bold: true, link: false, list: undefined }],
		['- [the d|ocs](https://docs.example.com)', { bold: false, link: true, list: 'bulleted' }],
		['Read [|](https://)', { bold: false, link: true, list: undefined }],
		['«1. One\n\n2. Two»', { bold: false, link: false, list: 'numbered' }],
		['«- One\n2. Two»', { bold: false, link: false, list: undefined }],
		['- |', { bold: false, link: false, list: 'bulleted' }]
	])('reports the formats at %s', (body, formats) => {
		expect(bodyFormats(parse(body))).toEqual(formats);
	});
});

describe('insertVariable', () => {
	const title = (selection: BodySelection) => insertVariable(selection, 'founderTitle');

	it.each([
		['Hi «you»,', 'Hi {{founderTitle}}|,'],
		['Hi |,', 'Hi {{founderTitle}}|,'],
		['Hi {{«userFirstName»}}!', 'Hi {{founderTitle}}|!'],
		['Hi {{user|FirstName}}!', 'Hi {{founderTitle}}|!'],
		['Hi «{{userFirstName}}»!', 'Hi {{founderTitle}}|!']
	])('turns %s into %s', (body, expected) => {
		expect(edit(title, body)).toBe(expected);
	});
});
