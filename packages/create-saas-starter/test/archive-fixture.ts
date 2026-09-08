import { gzipSync } from 'node:zlib';
import { Header, Pax, type HeaderData } from 'tar';

export interface TarFixtureEntry {
	path: string;
	type?: HeaderData['type'];
	data?: string | Buffer;
	linkpath?: string;
	mode?: number;
	paxPath?: string;
}

function paddedData(data: Buffer): Buffer {
	const padding = (512 - (data.length % 512)) % 512;
	return padding === 0 ? data : Buffer.concat([data, Buffer.alloc(padding)]);
}

export function tarGz(entries: TarFixtureEntry[]): Buffer {
	const chunks: Buffer[] = [];
	for (const entry of entries) {
		const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '');
		if (entry.paxPath) chunks.push(new Pax({ path: entry.paxPath }).encode());
		const headerData: HeaderData = {
			path: entry.path,
			type: entry.type ?? 'File',
			linkpath: entry.linkpath,
			size: entry.type === 'Directory' || entry.type === 'SymbolicLink' ? 0 : data.length,
			mode: entry.mode ?? (entry.type === 'Directory' ? 0o755 : 0o644),
			uid: 0,
			gid: 0,
			mtime: new Date(0)
		};
		let block = Buffer.alloc(512);
		if (new Header(headerData).encode(block)) {
			chunks.push(new Pax({ path: entry.path, linkpath: entry.linkpath }).encode());
			block = Buffer.alloc(512);
			if (new Header({ ...headerData, path: 'PaxEntry', linkpath: '' }).encode(block)) {
				throw new Error(`Fixture could not encode path: ${entry.path}`);
			}
		}
		chunks.push(block, paddedData(data));
	}
	chunks.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(chunks));
}

export function validTemplateEntries(): TarFixtureEntry[] {
	return [
		{
			path: 'root/package.json',
			data: '{"templateSetupVersion":1,"scripts":{"setup":"bun scripts/template-setup.ts"}}'
		},
		{ path: 'root/scripts/template-setup.ts', data: 'export {};' },
		{ path: 'root/src/lib/content/legal-metadata.ts', data: 'export {};' },
		{ path: 'root/AGENTS.md', data: '# Guidance\n' },
		{ path: 'root/CLAUDE.md', type: 'SymbolicLink', linkpath: 'AGENTS.md' },
		{ path: 'root/.agents/skills/example', type: 'Directory' },
		{ path: 'root/.agents/skills/example/SKILL.md', data: '# Skill\n' },
		{
			path: 'root/.claude/skills/example',
			type: 'SymbolicLink',
			linkpath: '../../.agents/skills/example'
		},
		{ path: 'root/scripts/executable.ts', data: 'export {};', mode: 0o755 }
	];
}
