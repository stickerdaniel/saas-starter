import { gzipSync } from 'node:zlib';
import { Header, Pax, type HeaderData } from 'tar';

export interface TarFixtureEntry {
	path: string;
	type?: HeaderData['type'];
	data?: string | Buffer;
	linkpath?: string;
	mode?: number;
	paxPath?: string;
	paxLinkpath?: string;
	rawPath?: string;
	rawLinkpath?: string;
	rawSize?: number;
	rawBase256Size?: number;
}

function paddedData(data: Buffer): Buffer {
	const padding = (512 - (data.length % 512)) % 512;
	return padding === 0 ? data : Buffer.concat([data, Buffer.alloc(padding)]);
}

function writeRawField(block: Buffer, offset: number, size: number, value: string): void {
	if (Buffer.byteLength(value) > size) throw new Error(`Raw fixture field exceeds ${size} bytes`);
	block.fill(0, offset, offset + size);
	block.write(value, offset, size, 'utf8');
}

function writeRawBase256Size(block: Buffer, size: number): void {
	if (!Number.isSafeInteger(size) || size >= 0)
		throw new Error('Raw base-256 fixture size must be negative');
	const encoded = Buffer.alloc(12);
	encoded[0] = 0xff;
	let remaining = -size;
	let flipped = false;
	for (let index = encoded.length - 1; index > 0; index--) {
		const byte = remaining & 0xff;
		remaining = Math.floor(remaining / 0x100);
		if (flipped) encoded[index] = 0xff ^ byte;
		else if (byte !== 0) {
			flipped = true;
			encoded[index] = ((0xff ^ byte) + 1) & 0xff;
		}
	}
	encoded.copy(block, 124);
}

function refreshChecksum(block: Buffer): void {
	block.fill(0x20, 148, 156);
	const checksum = block.reduce((sum, byte) => sum + byte, 0);
	block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
}

export function tarGz(entries: TarFixtureEntry[]): Buffer {
	const chunks: Buffer[] = [];
	for (const entry of entries) {
		const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '');
		if (entry.paxPath !== undefined || entry.paxLinkpath !== undefined) {
			chunks.push(new Pax({ path: entry.paxPath, linkpath: entry.paxLinkpath }).encode());
		}
		const headerData: HeaderData = {
			path: entry.rawPath === undefined ? entry.path : 'RawPath',
			type: entry.type ?? 'File',
			linkpath: entry.rawLinkpath === undefined ? entry.linkpath : 'RawLink',
			size:
				entry.rawBase256Size === undefined
					? (entry.rawSize ??
						(entry.type === 'Directory' || entry.type === 'SymbolicLink' ? 0 : data.length))
					: 0,
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
		if (entry.rawPath !== undefined) writeRawField(block, 0, 100, entry.rawPath);
		if (entry.rawLinkpath !== undefined) writeRawField(block, 157, 100, entry.rawLinkpath);
		if (entry.rawBase256Size !== undefined) writeRawBase256Size(block, entry.rawBase256Size);
		if (
			entry.rawPath !== undefined ||
			entry.rawLinkpath !== undefined ||
			entry.rawBase256Size !== undefined
		) {
			refreshChecksum(block);
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
		{ path: 'root/bun.lock', data: '{"lockfileVersion":1}\n' },
		{ path: 'root/scripts/template-setup.ts', data: 'export {};' },
		{ path: 'root/wrangler.toml', data: 'name = "fixture"\n' },
		{ path: 'root/README.md', data: '# Fixture\n' },
		{ path: 'root/src/lib/config/site.ts', data: 'export {};' },
		{ path: 'root/src/lib/config/legal.ts', data: 'export {};' },
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
