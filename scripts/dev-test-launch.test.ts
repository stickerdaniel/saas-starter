// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchTestServer } from './dev-test';

const tempDirs: string[] = [];

function stalePublication(): { cwd: string; publication: string } {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-starter-dev-test-launch-'));
	tempDirs.push(cwd);
	const convexDir = path.join(cwd, '.convex');
	const publication = path.join(convexDir, '.test-backend-url');
	fs.mkdirSync(convexDir);
	fs.writeFileSync(publication, 'http://localhost:1111');
	return { cwd, publication };
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('launchTestServer', () => {
	it('preflights before invalidating the publication and spawning Vite', async () => {
		const { cwd, publication } = stalePublication();
		const events: string[] = [];

		const child = await launchTestServer({
			testPort: 4173,
			portless: false,
			cwd,
			preflight: async () => {
				expect(fs.existsSync(publication)).toBe(true);
				events.push('preflight');
			},
			spawn: (command) => {
				expect(fs.existsSync(publication)).toBe(false);
				events.push('spawn');
				return { command };
			}
		});

		expect(events).toEqual(['preflight', 'spawn']);
		expect(child.command).toEqual(['vite', 'dev', '--port', '4173', '--strictPort']);
	});

	it('preserves an active publication when deterministic-port preflight fails', async () => {
		const { cwd, publication } = stalePublication();
		const collision = new Error('port in use');

		await expect(
			launchTestServer({
				testPort: 4173,
				portless: false,
				cwd,
				preflight: async () => {
					throw collision;
				},
				spawn: () => {
					throw new Error('Vite must not spawn after a port collision');
				}
			})
		).rejects.toBe(collision);
		expect(fs.readFileSync(publication, 'utf-8')).toBe('http://localhost:1111');
	});

	it('lets Portless own the port while still invalidating before spawn', async () => {
		const { cwd, publication } = stalePublication();
		const events: string[] = [];

		await launchTestServer({
			testPort: 4173,
			portless: true,
			cwd,
			preflight: async () => {
				events.push('preflight');
			},
			spawn: (command) => {
				expect(fs.existsSync(publication)).toBe(false);
				events.push(`spawn:${command.join(' ')}`);
			}
		});

		expect(events).toEqual(['spawn:vite dev']);
	});
});
