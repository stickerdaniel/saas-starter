import { asSchema } from 'ai';
import { describe, expect, it } from 'vitest';
import { getGeocoding, getWeather } from '../aiChat/tools/weather';
import { requestHandoff } from '../support/tools/handoff';

describe('AI tool input schemas', () => {
	it.each([
		[
			'getGeocoding',
			getGeocoding.inputSchema,
			`{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"location":{"type":"string","description":"The location to get the geocoding for, e.g. 'San Francisco'"}},"required":["location"],"additionalProperties":false}`
		],
		[
			'getWeather',
			getWeather.inputSchema,
			`{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"latitude":{"type":"number"},"longitude":{"type":"number"}},"required":["latitude","longitude"],"additionalProperties":false}`
		],
		[
			'requestHandoff',
			requestHandoff.inputSchema,
			`{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"additionalProperties":false}`
		]
	])('sends the %s JSON Schema to the model', async (_name, inputSchema, expected) => {
		expect(JSON.stringify(await asSchema(inputSchema).jsonSchema)).toBe(expected);
	});

	it('passes valid getWeather input to the tool without extra keys', async () => {
		expect(
			await asSchema(getWeather.inputSchema).validate?.({
				latitude: 25.03,
				longitude: 121.56,
				unit: 'celsius'
			})
		).toEqual({ success: true, value: { latitude: 25.03, longitude: 121.56 } });
	});

	it('refuses getWeather input without numeric coordinates', async () => {
		expect(
			await asSchema(getWeather.inputSchema).validate?.({ latitude: 'north', longitude: 121.56 })
		).toMatchObject({ success: false });
	});
});
