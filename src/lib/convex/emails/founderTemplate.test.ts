import { describe, expect, it } from 'vitest';
import { renderFounderEmail, type FounderTemplateVariables } from './founderTemplate';

const vars: FounderTemplateVariables = {
	userFirstName: 'Ada',
	userLastName: 'Lovelace',
	founderName: 'Sam',
	founderTitle: 'Founder'
};

const WRAPPER_OPEN =
	'<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#000">';

/** The HTML part without its wrapper `<div>`. */
function htmlBody(template: string, values = vars): string {
	const { html } = renderFounderEmail(template, values);
	expect(html.startsWith(WRAPPER_OPEN) && html.endsWith('</div>')).toBe(true);
	return html.slice(WRAPPER_OPEN.length, -'</div>'.length);
}

describe('renderFounderEmail', () => {
	it('renders a link as an anchor and as label plus URL in the text part', () => {
		const template = 'Open your [dashboard](https://app.example.com/dashboard), {{userFirstName}}.';

		expect(renderFounderEmail(template, vars).text).toBe(
			'Open your dashboard <https://app.example.com/dashboard>, Ada.'
		);
		expect(htmlBody(template)).toBe(
			'<p>Open your <a href="https://app.example.com/dashboard">dashboard</a>, Ada.</p>'
		);
	});

	it('renders bold as strong and as its plain text in the text part', () => {
		const template = 'Thanks, **{{userFirstName}}**!';

		expect(renderFounderEmail(template, vars).text).toBe('Thanks, Ada!');
		expect(htmlBody(template)).toBe('<p>Thanks, <strong>Ada</strong>!</p>');
	});

	it('writes a link labelled with its own URL once in the text part', () => {
		const template = '[https://example.com](https://example.com)';

		expect(renderFounderEmail(template, vars).text).toBe('https://example.com');
		expect(htmlBody(template)).toBe('<p><a href="https://example.com">https://example.com</a></p>');
	});

	it('escapes special characters in the href and in text', () => {
		const template = 'Q&A <now> "quoted" [a & b](https://example.com/?q="x"&y=<z>)';

		expect(htmlBody(template)).toBe(
			'<p>Q&amp;A &lt;now&gt; &quot;quoted&quot; ' +
				'<a href="https://example.com/?q=&quot;x&quot;&amp;y=&lt;z&gt;">a &amp; b</a></p>'
		);
	});

	it.each([
		['[x](https://evil.example)', '[x](https://evil.example)'],
		['**y**', '**y**'],
		['<b>z</b>', '&lt;b&gt;z&lt;/b&gt;']
	])('keeps a first name of %s literal inside a link label', (firstName, escaped) => {
		const template = 'Hi [{{userFirstName}}](https://example.com)';
		const values = { ...vars, userFirstName: firstName };

		expect(htmlBody(template, values)).toBe(
			`<p>Hi <a href="https://example.com">${escaped}</a></p>`
		);
		expect(renderFounderEmail(template, values).text).toBe(`Hi ${firstName} <https://example.com>`);
	});

	it('keeps a placeholder that injects a link literal in plain text', () => {
		const values = { ...vars, userFirstName: '[x](https://evil.example) **y**' };

		const html = htmlBody('Hi {{userFirstName}}', values);

		expect(html).toBe('<p>Hi [x](https://evil.example) **y**</p>');
		expect(renderFounderEmail('Hi {{userFirstName}}', values).text).toBe(
			'Hi [x](https://evil.example) **y**'
		);
	});

	it.each([
		'javascript:alert(1)',
		'"><script>alert(1)</script>',
		'https://evil.example/" onclick="x',
		'data:text/html,hi'
	])('renders a link whose URL placeholder becomes %s literally', (url) => {
		const values = { ...vars, userFirstName: url };

		const html = htmlBody('[click]({{userFirstName}})', values);

		expect(html).not.toContain('<a');
		expect(html).not.toContain('<script');
		expect(renderFounderEmail('[click]({{userFirstName}})', values).text).toBe(`[click](${url})`);
	});

	it('accepts a mailto link', () => {
		expect(htmlBody('[Write me](mailto:founder@example.com)')).toBe(
			'<p><a href="mailto:founder@example.com">Write me</a></p>'
		);
	});

	it.each([
		'[x](javascript:alert`1`)',
		'[x](data:text/html;base64,PGI+eDwvYj4=)',
		'[x](https://user:pass@example.com)',
		'[x](https://user@example.com)',
		'[x](/app/dashboard)',
		'[x](https:example.com)',
		'[x](https:/example.com)',
		'[x](https://example.com/a\u0007b)',
		'[x](https://example.com/a\u202Eb)',
		'![image](https://example.com/x.png)',
		'[[x](https://example.com)]',
		'***x***',
		'![**alt**](https://example.com/x.png)',
		'[[**x**](https://example.com)]',
		'***[go](https://example.com)***',
		'![**alt**](https://example.com/a(b).png)',
		'[[**x**](https://example.com/a(b))]',
		'![**alt**]',
		'![x](**bold**)',
		'[[x](**bold**)]',
		'![x]([go](https://example.com))',
		'![x](**bold** without a closing parenthesis'
	])('renders %s literally', (template) => {
		expect(htmlBody(template)).toBe(`<p>${template}</p>`);
		expect(renderFounderEmail(template, vars).text).toBe(template);
	});

	it('renders a link after an image as a link', () => {
		expect(htmlBody('![x](https://example.com/x.png) and [docs](https://example.com)')).toBe(
			'<p>![x](https://example.com/x.png) and <a href="https://example.com">docs</a></p>'
		);
	});

	it('keeps a lone star run literal and renders the bold after it', () => {
		expect(htmlBody('*** hi **there**')).toBe('<p>*** hi <strong>there</strong></p>');
	});

	it('still renders adjacent links and separate bold spans', () => {
		expect(htmlBody('[a](https://example.com)[b](https://example.org) **c**, **d**')).toBe(
			'<p><a href="https://example.com">a</a><a href="https://example.org">b</a> ' +
				'<strong>c</strong>, <strong>d</strong></p>'
		);
		expect(htmlBody('**a****b**')).toBe('<p><strong>a</strong><strong>b</strong></p>');
	});

	it('renders an unknown placeholder as an empty string', () => {
		expect(renderFounderEmail('Hi {{nickname}}!', vars).text).toBe('Hi !');
		expect(htmlBody('Hi {{nickname}}!')).toBe('<p>Hi !</p>');
		expect(renderFounderEmail('Hi {{constructor}}{{__proto__}}!', vars).text).toBe('Hi !');
	});

	it('starts a new paragraph after a line whose placeholder renders empty', () => {
		const template = 'Hi\n{{userLastName}}\nthere';
		const values = { ...vars, userLastName: '' };

		expect(renderFounderEmail(template, values).text).toBe('Hi\n\nthere');
		expect(htmlBody(template, values)).toBe('<p>Hi</p><p>there</p>');
	});

	it('treats Windows line endings like newlines', () => {
		expect(renderFounderEmail('Hi\r\nthere\r\n\r\nBye', vars).text).toBe('Hi\nthere\n\nBye');
		expect(htmlBody('Hi\r\nthere\r\n\r\nBye')).toBe('<p>Hi<br>there</p><p>Bye</p>');
	});

	it('splits paragraphs on blank lines and breaks lines on single newlines', () => {
		const template = 'Hi {{userFirstName}},\nquick question.\n\n\n  \nThanks\n{{founderName}}';

		expect(renderFounderEmail(template, vars).text).toBe(
			'Hi Ada,\nquick question.\n\n\n  \nThanks\nSam'
		);
		expect(htmlBody(template)).toBe('<p>Hi Ada,<br>quick question.</p><p>Thanks<br>Sam</p>');
	});

	it('leaves a template without markup as paragraphs and identical text', () => {
		const template =
			'Hi {{userFirstName}},\n\nwhat held you back?\n\n{{founderName}}, {{founderTitle}}';

		const { text } = renderFounderEmail(template, vars);

		expect(text).toBe('Hi Ada,\n\nwhat held you back?\n\nSam, Founder');
		expect(htmlBody(template)).toBe('<p>Hi Ada,</p><p>what held you back?</p><p>Sam, Founder</p>');
	});
});
