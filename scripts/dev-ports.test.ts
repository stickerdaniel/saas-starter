import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	BAD_FETCH_PORTS,
	computeDevPort,
	computeTestPort,
	parsePortOverride,
	portlessOwnsPort,
	resolveDevPort,
	resolveTestPort
} from './dev-ports';

// A spread of synthetic cwds, including worktree-style sibling paths and a
// relative path. None need to exist on disk: normalizeCwd falls back to
// path.resolve when realpathSync throws ENOENT.
const SAMPLE_CWDS = [
	'/a',
	'/b',
	'/Users/x/saas-starter',
	'/Users/x/saas-starter.worktrees/feat-dark-mode',
	'/Users/x/saas-starter.worktrees/fix-422',
	'/tmp/some/other/project',
	'relative/path'
];

describe('dev-ports: deterministic ranges', () => {
	it('dev port is stable per cwd and in [20000, 21000)', () => {
		for (const cwd of SAMPLE_CWDS) {
			expect(computeDevPort(cwd)).toBe(computeDevPort(cwd));
			expect(computeDevPort(cwd)).toBeGreaterThanOrEqual(20000);
			expect(computeDevPort(cwd)).toBeLessThan(21000);
		}
	});

	it('test port is stable per cwd and in [21000, 22000)', () => {
		for (const cwd of SAMPLE_CWDS) {
			expect(computeTestPort(cwd)).toBe(computeTestPort(cwd));
			expect(computeTestPort(cwd)).toBeGreaterThanOrEqual(21000);
			expect(computeTestPort(cwd)).toBeLessThan(22000);
		}
	});

	it('test port = dev port + 1000 (shared offset, predictable)', () => {
		for (const cwd of SAMPLE_CWDS) {
			expect(computeTestPort(cwd)).toBe(computeDevPort(cwd) + 1000);
		}
	});

	it('dev and test ranges never overlap', () => {
		const maxDev = Math.max(...SAMPLE_CWDS.map(computeDevPort));
		const minTest = Math.min(...SAMPLE_CWDS.map(computeTestPort));
		expect(maxDev).toBeLessThan(21000);
		expect(minTest).toBeGreaterThanOrEqual(21000);
	});

	it('distinct cwds map to distinct ports (no trivial collapse)', () => {
		const devPorts = new Set(SAMPLE_CWDS.map(computeDevPort));
		expect(devPorts.size).toBeGreaterThan(1);
	});

	it('no computed port is a WHATWG bad-fetch port', () => {
		for (const cwd of SAMPLE_CWDS) {
			expect(BAD_FETCH_PORTS.has(computeDevPort(cwd))).toBe(false);
			expect(BAD_FETCH_PORTS.has(computeTestPort(cwd))).toBe(false);
		}
	});
});

describe('dev-ports: override + portless env handling', () => {
	const ENV_KEYS = [
		'DEV_VITE_PORT',
		'TEST_VITE_PORT',
		'PORTLESS_SITE_URL',
		'E2E_OVERRIDE_SITE_URL'
	];
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		saved = {};
		for (const key of ENV_KEYS) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	it('a valid override wins over the computed port', () => {
		process.env.DEV_VITE_PORT = '20500';
		expect(resolveDevPort()).toBe(20500);
		process.env.TEST_VITE_PORT = '21500';
		expect(resolveTestPort()).toBe(21500);
	});

	it('unset/empty override falls back to the computed port', () => {
		expect(resolveDevPort()).toBe(computeDevPort());
		process.env.TEST_VITE_PORT = '   ';
		expect(resolveTestPort()).toBe(computeTestPort());
	});

	it('invalid override values fail loud', () => {
		for (const bad of ['abc', '0', '99999', '3.14', '5060']) {
			process.env.DEV_VITE_PORT = bad;
			expect(() => resolveDevPort(), `expected "${bad}" to throw`).toThrow(/DEV_VITE_PORT/);
		}
	});

	it('portlessOwnsPort: true only when PORTLESS_SITE_URL is set without E2E_OVERRIDE_SITE_URL', () => {
		expect(portlessOwnsPort()).toBe(false);

		process.env.PORTLESS_SITE_URL = 'http://myapp.localhost';
		expect(portlessOwnsPort()).toBe(true);

		process.env.E2E_OVERRIDE_SITE_URL = 'https://preview.example.com';
		expect(portlessOwnsPort()).toBe(false);
	});

	it('parsePortOverride returns undefined when unset', () => {
		expect(parsePortOverride('DEV_VITE_PORT')).toBeUndefined();
	});
});
