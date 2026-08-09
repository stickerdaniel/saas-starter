import { describe, expect, it } from 'vitest';

import { identifiersIn } from './convex-references';

const file = 'consumer.ts';

describe('identifiersIn', () => {
	it('reads ordinary public and internal member chains', () => {
		expect(
			identifiersIn('client.query(api.admin.queries.listUsers); internal.jobs.run;', file)
		).toEqual([
			{ identifier: 'admin/queries:listUsers', visibility: 'public', file },
			{ identifier: 'jobs:run', visibility: 'internal', file }
		]);
	});

	it('keeps dollar signs in module and function names', () => {
		expect(identifiersIn('client.query(api.$users.profile.$viewer, {});', file)).toEqual([
			{ identifier: '$users/profile:$viewer', visibility: 'public', file }
		]);
	});

	it('keeps Unicode JavaScript identifiers', () => {
		expect(identifiersIn('client.query(api.benutzer.übersicht.lesen, {});', file)).toEqual([
			{ identifier: 'benutzer/übersicht:lesen', visibility: 'public', file }
		]);
	});

	it('does not treat bracket notation as a direct reference', () => {
		expect(identifiersIn("api.users['viewer']", file)).toEqual([]);
	});
});
