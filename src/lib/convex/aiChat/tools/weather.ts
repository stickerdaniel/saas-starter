import { tool } from 'ai';
import { z } from 'zod';

export const getGeocoding = tool({
	description: 'Get the latitude and longitude of a location',
	inputSchema: z.object({
		location: z.string().describe("The location to get the geocoding for, e.g. 'San Francisco'")
	}),
	execute: async ({ location }) => {
		const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
		const response = await fetch(geocodingUrl);
		if (!response.ok) {
			throw new Error(`Geocoding API error: ${response.status} ${response.statusText}`);
		}
		const data = (await response.json()) as {
			results?: {
				latitude: number;
				longitude: number;
				name: string;
			}[];
		};

		if (!data.results?.[0]) {
			throw new Error(`Location '${location}' not found`);
		}

		const { latitude, longitude, name } = data.results[0];
		return { latitude, longitude, name };
	}
});

export const getWeather = tool({
	description: 'Get the weather for a location',
	inputSchema: z.object({
		latitude: z.number(),
		longitude: z.number()
	}),
	execute: async (args) => {
		const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code&wind_speed_unit=mph&temperature_unit=fahrenheit`;

		const response = await fetch(weatherUrl);
		if (!response.ok) {
			throw new Error(`Weather API error: ${response.status} ${response.statusText}`);
		}
		const data = (await response.json()) as {
			current: {
				temperature_2m: number;
				apparent_temperature: number;
				wind_speed_10m: number;
				wind_gusts_10m: number;
				weather_code: number;
			};
		};

		return {
			temperature: `${data.current.temperature_2m}\u00B0F`,
			feelsLike: `${data.current.apparent_temperature}\u00B0F`,
			windSpeed: `${data.current.wind_speed_10m} mph`,
			windGust: `${data.current.wind_gusts_10m} mph`,
			description: nameOfWeatherCode(data.current.weather_code)
		};
	}
});

function nameOfWeatherCode(code: number) {
	switch (code) {
		case 0:
			return 'Clear';
		case 1:
			return 'Mainly clear';
		case 2:
			return 'Partly cloudy';
		case 3:
			return 'Overcast';
		case 45:
		case 48:
			return 'Fog';
		case 51:
			return 'Light drizzle';
		case 53:
			return 'Moderate drizzle';
		case 55:
			return 'Dense drizzle';
		case 56:
		case 57:
			return 'Freezing drizzle';
		case 61:
			return 'Light rain';
		case 63:
			return 'Moderate rain';
		case 65:
			return 'Heavy rain';
		case 66:
			return 'Light freezing rain';
		case 67:
			return 'Heavy freezing rain';
		case 71:
			return 'Light snow';
		case 73:
			return 'Moderate snow';
		case 75:
			return 'Heavy snow';
		case 77:
			return 'Snow grains';
		case 80:
			return 'Slight rain showers';
		case 81:
			return 'Moderate rain showers';
		case 82:
			return 'Violent rain showers';
		case 85:
			return 'Slight snow showers';
		case 86:
			return 'Heavy snow showers';
		case 95:
			return 'Thunderstorm';
		case 96:
			return 'Thunderstorm with light hail';
		case 99:
			return 'Thunderstorm with heavy hail';
		default:
			return 'Unknown';
	}
}
