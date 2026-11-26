import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { CONFECT_LIBRARY_FUNCTIONS } from './convex-registrars.js';

type Inventory = { groups: Record<string, Record<string, [string, string, string, string]>> };

const inventory: Inventory = JSON.parse(
	readFileSync(
		path.join(import.meta.dirname, '../src/lib/confect/__goldens__/inventory.json'),
		'utf8'
	)
);

it('lists every function the inventory golden records with plain provenance', () => {
	const plain = Object.entries(inventory.groups).flatMap(([group, functions]) =>
		Object.entries(functions)
			.filter(([, row]) => row[3] === 'Convex')
			.map(([name]) => `${group}:${name}`)
	);
	expect(plain.toSorted()).toEqual(Object.values(CONFECT_LIBRARY_FUNCTIONS).flat().toSorted());
});
