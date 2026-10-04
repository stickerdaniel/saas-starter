import { describe, expect, it } from 'vitest';
import { filterCatalogueEntries, type CatalogueEntry } from './catalogue';

const MIT_TEXT = `MIT License

Copyright 2023 Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software, to deal in the Software without limitation. The above
copyright notice and this permission notice shall be included in all copies.`;

function entry(
	name: string,
	license: string,
	text: string,
	components = ['client']
): CatalogueEntry {
	return {
		id: `npm:${name}@1.0.0`,
		kind: 'package',
		name,
		version: '1.0.0',
		license,
		components,
		sourceUrl: `https://github.com/example/${name}`,
		notices: [{ label: 'LICENSE', text }]
	};
}

const entries = [
	entry(
		'ai',
		'Apache-2.0',
		`${MIT_TEXT.replace('MIT License', 'Apache License')}\nUse is permitted.`
	),
	entry(
		'bits-ui',
		'MIT',
		'Copyright (c) 2023 Hunter\nJohnston\n\nIN NO EVENT SHALL THE AUTHORS OR\nCOPYRIGHT HOLDERS BE LIABLE FOR ANY DAMAGES.'
	),
	entry(
		'pdfjs',
		'Apache-2.0',
		'This product includes software developed at the Mozilla Foundation. Müller wrote the (c++) bindings.',
		['client-worker']
	)
];

const names = (query: string, label?: (component: string) => string) =>
	filterCatalogueEntries(entries, query, label).map((e) => e.name);

describe('filterCatalogueEntries', () => {
	it('finds a package by its copyright holder, across a wrapped line', () => {
		expect(names('vercel')).toEqual(['ai']);
		expect(names('Hunter Johnston')).toEqual(['bits-ui']);
	});

	it('finds a holder named outside any copyright line', () => {
		expect(names('mozilla')).toEqual(['pdfjs']);
		expect(names('MOZILLA FOUND')).toEqual(['pdfjs']);
	});

	it('matches notice text only where a word starts', () => {
		// "permitted", "permission", and "limitation" contain "mit" but do not start with it.
		expect(names('mit')).toEqual(['bits-ui']);
		expect(names('ermitted')).toEqual([]);
		expect(names('ller')).toEqual([]);
		expect(names('müller')).toEqual(['pdfjs']);
	});

	it('treats the query literally', () => {
		expect(names('(c++)')).toEqual(['pdfjs']);
		expect(names('.*')).toEqual([]);
		expect(names('hunter.johnston')).toEqual([]);
	});

	it('keeps substring matches for the row fields', () => {
		expect(names('2.0')).toEqual(['ai', 'pdfjs']);
		expect(names('its-u')).toEqual(['bits-ui']);
	});

	it('finds a component by its displayed label and by its key', () => {
		const german = (component: string) =>
			({ client: 'Browser-App', 'client-worker': 'Browser-Worker' })[component] ?? component;
		expect(names('browser-worker', german)).toEqual(['pdfjs']);
		expect(names('browser-app', german)).toEqual(['ai', 'bits-ui']);
		expect(names('client-worker', german)).toEqual(['pdfjs']);
		expect(names('browser-app')).toEqual([]);
	});

	it('returns every entry for an empty query', () => {
		expect(names('  ')).toEqual(['ai', 'bits-ui', 'pdfjs']);
	});
});
