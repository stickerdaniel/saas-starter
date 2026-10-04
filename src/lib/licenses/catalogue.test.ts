import { describe, expect, it } from 'vitest';
import { filterCatalogueEntries, type CatalogueEntry } from './catalogue';

const MIT_TEXT = `MIT License

Copyright 2023 Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software, to deal in the Software without limitation. The above
copyright notice and this permission notice shall be included in all copies.`;

function entry(name: string, license: string, text: string): CatalogueEntry {
	return {
		id: `npm:${name}@1.0.0`,
		kind: 'package',
		name,
		version: '1.0.0',
		license,
		components: ['client'],
		sourceUrl: `https://github.com/example/${name}`,
		notices: [{ label: 'LICENSE', text }]
	};
}

const entries = [
	entry('ai', 'Apache-2.0', MIT_TEXT.replace('MIT License', 'Apache License')),
	entry('bits-ui', 'MIT', 'Copyright (c) 2023 Hunter Johnston\n\nPermission is hereby granted.')
];

const names = (query: string) => filterCatalogueEntries(entries, query).map((e) => e.name);

describe('filterCatalogueEntries', () => {
	it('finds a package by its copyright holder', () => {
		expect(names('vercel')).toEqual(['ai']);
		expect(names('Hunter Johnston')).toEqual(['bits-ui']);
	});

	it('keeps license searches to the declared license', () => {
		expect(names('mit')).toEqual(['bits-ui']);
	});

	it('returns every entry for an empty query', () => {
		expect(names('  ')).toEqual(['ai', 'bits-ui']);
	});
});
