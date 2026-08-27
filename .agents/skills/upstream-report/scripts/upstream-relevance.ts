#!/usr/bin/env bun
/**
 * upstream-relevance.ts: decide, per changed file, whether a change could
 * belong in the upstream template.
 *
 * This exists so the question stops being a judgement call. A fork accumulates
 * its own code next to copied template code, and after a few months nobody can
 * tell them apart by looking. Guessing goes both ways: template bugs get fixed
 * privately and every other fork keeps them, or fork-only work gets offered
 * upstream where it makes no sense.
 *
 * Three outcomes, every one of them measured:
 *
 *   pristine   the path exists upstream and, BEFORE this change, was identical
 *              to it. Editing untouched template code is the strongest signal
 *              there is: whatever was wrong there is wrong upstream too.
 *   diverged   the path exists upstream but the fork had already rewritten it.
 *              Only here does the line-level check earn its cost.
 *   unmeasured a comparison was unavailable or found a possible tie: binary
 *              content, a missing partial-clone blob, a submodule, a renamed or
 *              copied file. Reported, because missing evidence proves nothing.
 *
 * Every failure mode here is asymmetric, and the code leans one way throughout.
 * A false "look at this" costs one glance. A false "nothing to report" loses a
 * fix for every other fork, permanently and silently. So anything the detector
 * cannot establish is surfaced or made fatal, never quietly resolved as a
 * negative.
 *
 * Read-only inside the repository unless --fetch is explicit. Default base
 * validation reads origin with ls-remote; fetch mode may add the upstream remote,
 * update its tracking ref, and record the fetch time in local Git config.
 *
 * Usage:
 *   bun .agents/skills/upstream-report/scripts/upstream-relevance.ts [paths...]
 *     --base <ref>   compare from the merge base with this ref instead of origin/main
 *     --fetch        allow creating the upstream remote and fetching it (writes git state)
 *     --json         machine-readable output
 *     --all          accepted for compatibility; every classified path is already listed
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	chmodSync,
	closeSync,
	constants as fsConstants,
	existsSync,
	fstatSync,
	lstatSync,
	mkdtempSync,
	mkdirSync,
	openSync,
	readFileSync,
	readlinkSync,
	readSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import type { Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_UPSTREAM = 'https://github.com/stickerdaniel/saas-starter.git';
const MARKER = '.upstream-sync.json';
const UPSTREAM_REF = 'refs/remotes/upstream/main';
const UPSTREAM_FETCH_CONFIG = 'upstreamReport.lastFetch';
const MAX_MARKER_BYTES = 1024 * 1024;
const TEMP_ROOT = tmpdir();
const NO_GRAFTS = process.platform === 'win32' ? 'NUL' : '/dev/null';
const WINDOWS_SAFETY_MODE =
	process.platform === 'win32' ||
	(process.env.NODE_ENV === 'test' && process.env.UPSTREAM_REPORT_TEST_WINDOWS_SAFETY === '1');

// Two days of upstream commits added seven paths that an old copy could not
// compare. One full day is the first age the summary calls stale; the warning,
// JSON flag and summary all use this threshold.
const STALE_AFTER_DAYS = 1;

// Overlap ranks a shared file's changes; it does NOT gate them. Three review
// rounds each found a new input where a threshold silently dropped a real
// finding, because the underlying question is undecidable from line matching:
// a removed line absent upstream is either fork-only code or a template line
// this fork had renamed, and nothing in the diff distinguishes them. The last
// measurement settled it: on the branch that carried this repository's one
// genuine upstream bug, a 20% gate suppressed exactly that file at 15%.
//
// So every shared file that changed is reported, ordered by how much of what it
// replaced still exists upstream. That costs about five extra glances on a
// forty-file branch and removes the whole class of silent false negatives.

// Every repository-local variable git documents. Leaving GIT_COMMON_DIR in
// place lets an inherited value point the whole run at another repository's
// refs and config, which reads as a completely normal set of wrong verdicts.
const SCRUBBED = [
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_IMPLICIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_COMMON_DIR',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_CEILING_DIRECTORIES',
	'GIT_CONFIG',
	'GIT_CONFIG_PARAMETERS',
	'GIT_GRAFT_FILE',
	'GIT_NO_REPLACE_OBJECTS',
	'GIT_REPLACE_REF_BASE',
	'GIT_PREFIX',
	'GIT_SHALLOW_FILE',
	'GIT_NAMESPACE',
	'GIT_ALLOW_PROTOCOL',
	'GIT_PROTOCOL_FROM_USER',
	'GIT_SSH',
	'GIT_SSH_COMMAND',
	'GIT_SSH_VARIANT',
	'GIT_PROXY_COMMAND',
	'GIT_SSL_NO_VERIFY',
	'GIT_LITERAL_PATHSPECS',
	'GIT_NOGLOB_PATHSPECS',
	'GIT_GLOB_PATHSPECS',
	'GIT_ICASE_PATHSPECS'
];
function gitEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	const scrubbed = new Set(SCRUBBED.map((key) => key.toUpperCase()));
	for (const key of Object.keys(env)) {
		const normalized = key.toUpperCase();
		if (
			scrubbed.has(normalized) ||
			/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(normalized) ||
			normalized.startsWith('GIT_TRACE')
		) {
			delete env[key];
		}
	}
	return env;
}

function inheritedEnvironment(name: string): string | undefined {
	const key = Object.keys(process.env).find((candidate) => candidate.toUpperCase() === name);
	return key === undefined ? undefined : process.env[key];
}

const PRIVATE_TRANSPORT_PROTOCOLS = new Set(['file', 'https', 'ssh']);
function gitBooleanIsFalse(value: string | undefined): boolean {
	return value !== undefined && /^(?:|0|false|no|off)$/i.test(value);
}

function transportProtocolEnv(): NodeJS.ProcessEnv {
	const inherited = inheritedEnvironment('GIT_ALLOW_PROTOCOL');
	const fromUser = inheritedEnvironment('GIT_PROTOCOL_FROM_USER');
	const userProtocolsDisabled = gitBooleanIsFalse(fromUser);
	const permitted = inherited
		?.split(':')
		.filter((protocol) => PRIVATE_TRANSPORT_PROTOCOLS.has(protocol))
		.join(':');
	return {
		...(permitted === undefined ? {} : { GIT_ALLOW_PROTOCOL: permitted }),
		...(userProtocolsDisabled ? { GIT_PROTOCOL_FROM_USER: '0' } : {})
	};
}

function transportConfigEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: String(transportEnvironmentConfig.length) };
	for (const [index, [key, value]] of transportEnvironmentConfig.entries()) {
		env[`GIT_CONFIG_KEY_${index}`] = key;
		env[`GIT_CONFIG_VALUE_${index}`] = value;
	}
	return env;
}

// Config pinned on every invocation, because each of these changes the answer
// instead of failing:
//   core.quotePath=false  the default returns a non-ASCII path as an escaped,
//                         quoted string ("enc\303\266ded") that then fails when
//                         handed straight back to rev-parse or diff.
//   diff.ignoreSubmodules inherited as `all` it drops every submodule change
//                         from all three diff collectors. Each diff also passes
//                         --ignore-submodules=none, which overrides the stronger
//                         per-submodule ignore setting.
//   diff.renameLimit=0    keeps inexact rename detection exhaustive. A skipped
//                         source loses the local blob that proves provenance.
//   core.fsmonitor=       an fsmonitor hook is another program a read-only run
//                         would execute, and it keeps a cache of its own.
//   core.splitIndex=false prevents a copied ordinary index from creating shared
//                         backing state in the repository during refresh.
//   core.trustctime=true
//   core.checkStat=default
//   core.ignoreStat=false  keep same-size edits visible when repository config
//                         weakens Git's stat-cache checks.
//   color.ui=false        `always` prefixes diff markers with ANSI bytes, so the
//                         hunk parser sees no `@@`, removal or context lines.
//   advice.graftFileDeprecated=false  the empty null-device override otherwise warns
//                         once per Git process and drowns out the report.
const PINNED_CONFIG = [
	...(process.platform === 'win32' ? [] : ['-c', 'core.fileMode=true']),
	'-c',
	'core.quotePath=false',
	'-c',
	'diff.ignoreSubmodules=none',
	'-c',
	'diff.renameLimit=0',
	'-c',
	'core.fsmonitor=',
	'-c',
	'core.splitIndex=false',
	'-c',
	'core.trustctime=true',
	'-c',
	'core.checkStat=default',
	'-c',
	'core.ignoreStat=false',
	'-c',
	'color.ui=false',
	'-c',
	'advice.graftFileDeprecated=false'
];

/**
 * The environment every git call in this file runs under. One function, because
 * a read that skipped any of these would be a read this file promises it does
 * not make.
 */
function gitRunEnv(): NodeJS.ProcessEnv {
	ensureScratchIndexExists();
	return {
		...gitEnv(),
		GIT_EXTERNAL_DIFF: '',
		GIT_TERMINAL_PROMPT: '0',
		// Every worktree read happens against a private copy of the index, so the
		// refresh a stat-only mismatch triggers writes there. Without it a run
		// takes index.lock in the caller's repository and can fail a concurrent
		// `git add`. GIT_OPTIONAL_LOCKS is not the answer: on git 2.55 it
		// suppresses the rewrite for `git status` and not for `git diff`, which is
		// the command this file actually uses.
		...(scratchIndex ? { GIT_INDEX_FILE: scratchIndex } : {}),
		// Freeze the commit graph alongside the index. A shared shallow boundary can
		// otherwise appear and disappear between matching endpoint snapshots.
		...(scratchShallow ? { GIT_SHALLOW_FILE: scratchShallow } : {}),
		GIT_OPTIONAL_LOCKS: '0',
		// In a partial clone an ordinary read fetches missing objects from the
		// promisor remote and writes a pack into the shared object store. That is
		// network and disk from a command that promises neither.
		GIT_NO_LAZY_FETCH: '1',
		// Replacement refs make object readers see a different commit while
		// rev-parse still prints the original SHA. Ignore them for every snapshot.
		GIT_NO_REPLACE_OBJECTS: '1',
		// Deleting GIT_GRAFT_FILE re-enables .git/info/grafts. The null device
		// cannot be planted with graft records by another process.
		GIT_GRAFT_FILE: NO_GRAFTS
	};
}

function trustedTransportEnv(): NodeJS.ProcessEnv {
	if (!transportGitDir || !transportObjectDir || !transportShallow) {
		fail('The private transport repository is unavailable. Run the report again.');
	}
	return {
		...transportProtocolEnv(),
		...transportConfigEnv(),
		GIT_DIR: transportGitDir,
		GIT_OBJECT_DIRECTORY: transportObjectDir,
		GIT_SHALLOW_FILE: transportShallow,
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_CONFIG_GLOBAL: NO_GRAFTS,
		GIT_CONFIG_SYSTEM: NO_GRAFTS
	};
}

function quotedGitConfig(value: string): string {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 7 || (code >= 11 && code <= 31) || code === 127) {
			fail('Git transport config contains a control character that cannot be copied safely.');
		}
	}
	return `"${value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replaceAll(String.fromCharCode(8), '\\b')
		.replace(/\t/g, '\\t')
		.replace(/\n/g, '\\n')}"`;
}

function appendTransportConfig(configPath: string, key: string, value: string): void {
	const first = key.indexOf('.');
	const last = key.lastIndexOf('.');
	if (first <= 0 || last === key.length - 1) {
		fail('Git returned a transport config key that cannot be copied safely.');
	}
	const section = key.slice(0, first);
	const name = key.slice(last + 1);
	if (!/^[a-z][a-z0-9-]*$/i.test(section) || !/^[a-z][a-z0-9-]*$/i.test(name)) {
		fail('Git returned a transport config key that cannot be copied safely.');
	}
	const header =
		first === last ? `[${section}]` : `[${section} ${quotedGitConfig(key.slice(first + 1, last))}]`;
	writeFileSync(configPath, `${header}\n\t${name} = ${quotedGitConfig(value)}\n`, { flag: 'a' });
}

function proxyCarriesUserinfo(value: string): boolean {
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
		return /^[^/\\\s]*@/.test(value);
	}
	try {
		const parsed = new URL(value);
		return parsed.username !== '' || parsed.password !== '';
	} catch {
		return true;
	}
}

function safeWindowsTransportValue(key: string, value: string): boolean {
	if (!WINDOWS_SAFETY_MODE) return true;
	const lower = key.toLowerCase();
	if (lower.startsWith('credential.') || lower.endsWith('.extraheader')) return false;
	if ((lower === 'http.proxy' || lower.endsWith('.proxy')) && proxyCarriesUserinfo(value)) {
		return false;
	}
	return true;
}

const TRANSPORT_CONFIG_PATTERN =
	'^(credential\\.|http\\.(pinnedpubkey|proxy|proxyauthmethod|proxysslcainfo|proxysslverify|schannelusesslcainfo|sslbackend|sslcainfo|sslcapath|sslverify)$|http\\..*\\.(extraheader|pinnedpubkey|proxy|proxyauthmethod|proxysslcainfo|proxysslcert|proxysslcertpasswordprotected|proxysslkey|proxysslverify|schannelusesslcainfo|sslcainfo|sslcapath|sslcert|sslcertpasswordprotected|sslkey|sslverify)$|protocol(\\.[^.]*)?\\.allow$|remote\\..*\\.(url|proxy|proxyauthmethod)$)';

function readTransportConfiguration(): Buffer {
	return gitBytes(['config', '--null', '--get-regexp', TRANSPORT_CONFIG_PATTERN], true);
}

function copyTransportConfiguration(configPath: string): void {
	const remoteProxyByName = new Map<string, RemoteProxySettings>();
	const output = readTransportConfiguration();
	transportConfigurationAtCopy = output;
	for (const record of decodeZRecords(output)) {
		const newline = record.indexOf('\n');
		if (newline === -1) continue;
		const key = record.slice(0, newline);
		const value = record.slice(newline + 1);
		if (key.toLowerCase() === 'protocol.allow') {
			transportProtocolPolicies.set('*', value.toLowerCase());
			continue;
		}
		const protocol = /^protocol\.([^.]+)\.allow$/i.exec(key)?.[1];
		if (protocol) {
			transportProtocolPolicies.set(protocol, value.toLowerCase());
			continue;
		}
		const remoteSetting = /^remote\.(.*)\.(url|proxy|proxyauthmethod)$/i.exec(key);
		if (remoteSetting) {
			const settings = remoteProxyByName.get(remoteSetting[1]!) ?? {};
			const setting = remoteSetting[2]!.toLowerCase();
			if (setting === 'url') {
				if (settings.url !== undefined) {
					fail(`The \`${terminalSafe(remoteSetting[1]!)}\` remote has multiple fetch URLs.`);
				}
				settings.url = value;
			} else if (setting === 'proxy') settings.proxy = value;
			else settings.proxyAuthMethod = value;
			remoteProxyByName.set(remoteSetting[1]!, settings);
			continue;
		}
		if (!safeWindowsTransportValue(key, value)) {
			transportEnvironmentConfig.push([key, value]);
			continue;
		}
		appendTransportConfig(configPath, key, value);
	}
	const globalProtocolPolicy = transportProtocolPolicies.get('*') ?? '';
	if (globalProtocolPolicy !== '' && !/^(?:always|never|user)$/.test(globalProtocolPolicy)) {
		fail('Git protocol.allow has an invalid policy.');
	}
	appendTransportConfig(configPath, 'protocol.allow', 'never');
	for (const [protocol, fallback] of [
		['file', 'user'],
		['https', 'always'],
		['ssh', 'always']
	] as const) {
		const configured = transportProtocolPolicies.get(protocol) ?? '';
		if (configured !== '' && !/^(?:always|never|user)$/.test(configured)) {
			fail(`Git protocol.${protocol}.allow has an invalid policy.`);
		}
		const policy =
			configured ||
			(/^(?:never|user)$/.test(globalProtocolPolicy) ? globalProtocolPolicy : fallback);
		transportProtocolPolicies.set(protocol, policy);
		appendTransportConfig(configPath, `protocol.${protocol}.allow`, policy);
	}
	for (const remote of ['origin', 'upstream']) {
		const settings = remoteProxyByName.get(remote);
		if (settings?.url) transportProxyByUrl.set(settings.url, settings);
	}
}

function verifyTransportConfiguration(): void {
	if (
		transportConfigurationAtCopy === null ||
		!readTransportConfiguration().equals(transportConfigurationAtCopy)
	) {
		fail('Git transport configuration changed during this report. Run it again on settled config.');
	}
}

function transportRemote(url: string): string {
	verifyLocalRemoteSnapshot(url);
	const existing = transportRemotes.get(url);
	if (existing) return existing;
	if (!transportConfigPath) {
		fail('The private transport configuration is unavailable. Run the report again.');
	}
	rejectUnauthenticatedTransport(url);
	rejectSecretBearingRemoteUrl(url);
	rejectDisabledTlsVerification(url);
	const transportUrl = validatedTransportUrls.get(url);
	if (!transportUrl) fail('The remote URL reached transport before location validation.');
	const name = `upstream-report-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
	appendTransportConfig(transportConfigPath, `remote.${name}.url`, transportUrl);
	const proxy = transportProxyByUrl.get(url);
	if (proxy?.proxy !== undefined) {
		const key = `remote.${name}.proxy`;
		if (safeWindowsTransportValue(key, proxy.proxy))
			appendTransportConfig(transportConfigPath, key, proxy.proxy);
		else transportEnvironmentConfig.push([key, proxy.proxy]);
	}
	if (proxy?.proxyAuthMethod !== undefined) {
		appendTransportConfig(
			transportConfigPath,
			`remote.${name}.proxyAuthMethod`,
			proxy.proxyAuthMethod
		);
	}
	transportRemotes.set(url, name);
	return name;
}

function rejectUnauthenticatedTransport(url: string): void {
	if (/^[a-z][a-z0-9+.-]*::/i.test(url)) {
		fail('Forced Git remote-helper syntax is not accepted for upstream evidence.');
	}
	if (/^file:(?!\/\/)/i.test(url)) {
		fail('Local upstream file URLs must use the canonical file:///absolute/path form.');
	}
	if (/^(?:https|ssh|file):/i.test(url)) return;
	if (isAbsolute(url)) return;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
		fail(
			`Cannot trust ${terminalUrl(url)} because upstream evidence requires HTTPS, SSH, or a local file transport.`
		);
	}
	if (/^(?:[^/\\]+@)?[^/\\:]+:.+/.test(url)) return;
}

function rejectDisabledTlsVerification(url: string): void {
	if (!/^https:/i.test(url)) return;
	for (const key of ['http.sslVerify', 'http.proxySSLVerify']) {
		const value = gitBytes(
			['config', '--type=bool', '--get-urlmatch', key, url],
			true,
			trustedTransportEnv()
		)
			.toString('utf8')
			.trim();
		if (value === 'false') {
			fail('Upstream evidence requires TLS and proxy TLS verification.');
		}
	}
}

function rejectSecretBearingRemoteUrl(url: string): void {
	let unsafe: boolean;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
		try {
			const parsed = new URL(url);
			const standardSshUser =
				(parsed.protocol === 'ssh:' || parsed.protocol === 'git+ssh:') &&
				parsed.username === 'git' &&
				parsed.password === '';
			unsafe =
				parsed.search !== '' ||
				parsed.hash !== '' ||
				parsed.password !== '' ||
				(parsed.username !== '' && !standardSshUser);
		} catch {
			unsafe = true;
		}
	} else {
		const scp = /^(?:([^/@:\s]+)@)?[^/:\s]+:(.*)$/.exec(url);
		unsafe =
			scp !== null &&
			((scp[1] !== undefined && scp[1] !== 'git') ||
				scp[2]!.includes('?') ||
				scp[2]!.includes('#'));
	}
	if (!unsafe) return;
	fail(
		`Cannot use ${terminalUrl(url)} because its URL carries userinfo, a query, or a fragment. ` +
			'Use a credential-free remote and keep authentication in a credential helper or URL-scoped HTTP config.'
	);
}

// Enough for a whole repository's text read in one batch. An overrun is an
// ENOBUFS throw, so this number is the difference between reading upstream and
// failing the run.
const MAX_GIT_OUTPUT = 256 * 1024 * 1024;
const DEFAULT_BLOB_OUTPUT_LIMIT = 256 * 1024 * 1024;
const BLOB_OUTPUT_LIMIT =
	process.env.NODE_ENV === 'test' &&
	/^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_BLOB_OUTPUT_LIMIT ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_BLOB_OUTPUT_LIMIT)
		: DEFAULT_BLOB_OUTPUT_LIMIT;
const BLOB_BATCH_BYTES = Math.max(1, Math.floor(BLOB_OUTPUT_LIMIT / 4));
const BLOB_BATCH_ITEMS = 4096;
const DEFAULT_CAPTURE_LIMIT = 256 * 1024 * 1024;
const CAPTURE_LIMIT =
	process.env.NODE_ENV === 'test' &&
	/^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_CAPTURE_LIMIT ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_CAPTURE_LIMIT)
		: DEFAULT_CAPTURE_LIMIT;
// Character grams retain four bytes per input character before string and map
// overhead. Large generated files stay visible without expanding into gigabytes.
const DEFAULT_SIMILARITY_SOURCE_LIMIT = 8 * 1024 * 1024;
const SIMILARITY_SOURCE_LIMIT =
	process.env.NODE_ENV === 'test' &&
	/^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_SIMILARITY_LIMIT ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_SIMILARITY_LIMIT)
		: DEFAULT_SIMILARITY_SOURCE_LIMIT;
// Character grams cost four bytes each; distinct-line map entries cost much more.
// Weighted units bound both before either representation is retained.
const DEFAULT_SIMILARITY_REPRESENTATION_LIMIT = 4 * 1024 * 1024;
const SIMILARITY_REPRESENTATION_LIMIT =
	process.env.NODE_ENV === 'test' &&
	/^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_SIMILARITY_REPRESENTATION_LIMIT ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_SIMILARITY_REPRESENTATION_LIMIT)
		: DEFAULT_SIMILARITY_REPRESENTATION_LIMIT;
// Bound the cross-product of changed content and historical upstream candidates.
// Representation limits cap memory; they do not cap repeated comparisons.
const DEFAULT_SIMILARITY_OPERATION_LIMIT = 10_000_000;
const SIMILARITY_OPERATION_LIMIT =
	process.env.NODE_ENV === 'test' &&
	/^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_SIMILARITY_OPERATION_LIMIT ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_SIMILARITY_OPERATION_LIMIT)
		: DEFAULT_SIMILARITY_OPERATION_LIMIT;
const DEFAULT_NETWORK_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MS =
	process.env.NODE_ENV === 'test' && /^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_TIMEOUT_MS ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_TIMEOUT_MS)
		: DEFAULT_NETWORK_TIMEOUT_MS;
const DEFAULT_WORKTREE_TIMEOUT_MS = 30_000;
const WORKTREE_TIMEOUT_MS =
	process.env.NODE_ENV === 'test' &&
	/^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_WORKTREE_TIMEOUT_MS ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_WORKTREE_TIMEOUT_MS)
		: DEFAULT_WORKTREE_TIMEOUT_MS;
const DEFAULT_PATH_LIMIT = 500_000;
const PATH_LIMIT =
	process.env.NODE_ENV === 'test' && /^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_PATH_LIMIT ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_PATH_LIMIT)
		: DEFAULT_PATH_LIMIT;
const DEFAULT_DIFF_COMMAND_TIMEOUT_MS = 30_000;
const DIFF_COMMAND_TIMEOUT_MS =
	process.env.NODE_ENV === 'test' &&
	/^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_DIFF_TIMEOUT_MS ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_DIFF_TIMEOUT_MS)
		: DEFAULT_DIFF_COMMAND_TIMEOUT_MS;
const DEFAULT_DIFF_OPERATION_LIMIT = 2_000;
let diffOperationsRemaining =
	process.env.NODE_ENV === 'test' &&
	/^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_DIFF_OPERATION_LIMIT ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_DIFF_OPERATION_LIMIT)
		: DEFAULT_DIFF_OPERATION_LIMIT;
const DEFAULT_HISTORY_RECORD_LIMIT = 500_000;
const HISTORY_RECORD_LIMIT =
	process.env.NODE_ENV === 'test' &&
	/^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_HISTORY_RECORD_LIMIT ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_HISTORY_RECORD_LIMIT)
		: DEFAULT_HISTORY_RECORD_LIMIT;
const DEFAULT_HISTORY_OPERATION_LIMIT = 500;
let historyOperationsRemaining =
	process.env.NODE_ENV === 'test' &&
	/^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_HISTORY_OPERATION_LIMIT ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_HISTORY_OPERATION_LIMIT)
		: DEFAULT_HISTORY_OPERATION_LIMIT;
const DEFAULT_HISTORY_COMMAND_TIMEOUT_MS = 5_000;
const HISTORY_COMMAND_TIMEOUT_MS =
	process.env.NODE_ENV === 'test' &&
	/^\d+$/.test(process.env.UPSTREAM_REPORT_TEST_HISTORY_TIMEOUT_MS ?? '')
		? Number(process.env.UPSTREAM_REPORT_TEST_HISTORY_TIMEOUT_MS)
		: DEFAULT_HISTORY_COMMAND_TIMEOUT_MS;

function gitBytes(
	args: string[],
	allowFail = false,
	extraEnv: NodeJS.ProcessEnv = {},
	timeout?: number
): Buffer {
	try {
		const output = execFileSync('git', [...PINNED_CONFIG, ...args], {
			env: { ...gitRunEnv(), ...extraEnv },
			maxBuffer: MAX_GIT_OUTPUT,
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout
		});
		ensureScratchIndexExists();
		return output;
	} catch (err) {
		ensureScratchIndexExists();
		if ((err as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
			fail(`Git operation timed out after ${Math.ceil((timeout ?? 0) / 1000)} seconds.`);
		}
		if (allowFail) return Buffer.alloc(0);
		throw err;
	}
}

function gitPartialBytes(
	args: string[],
	input?: string | Buffer,
	timeout?: number
): { output: Buffer; complete: boolean } {
	try {
		return {
			output: execFileSync('git', [...PINNED_CONFIG, ...args], {
				env: gitRunEnv(),
				maxBuffer: MAX_GIT_OUTPUT,
				input,
				stdio: ['pipe', 'pipe', 'pipe'],
				timeout
			}),
			complete: true
		};
	} catch (err) {
		const output = (err as { stdout?: unknown }).stdout;
		return { output: Buffer.isBuffer(output) ? output : Buffer.alloc(0), complete: false };
	}
}

function git(args: string[], allowFail = false, timeout?: number): string {
	return gitBytes(args, allowFail, {}, timeout).toString('utf8').trim();
}

function gitPath(args: string[]): string {
	const value = gitBytes(args).toString('utf8');
	return value.endsWith('\n') ? value.slice(0, -1) : value;
}

function gitUnpinned(args: string[], allowFail = false): string {
	try {
		return execFileSync('git', args, {
			env: gitRunEnv(),
			maxBuffer: MAX_GIT_OUTPUT,
			stdio: ['pipe', 'pipe', 'pipe']
		})
			.toString('utf8')
			.trim();
	} catch {
		if (allowFail) return '';
		throw new Error('Git could not read unpinned repository configuration.');
	}
}

/**
 * A NUL-delimited path read. Decode each record strictly: Git permits arbitrary
 * non-NUL bytes in a pathname, while JavaScript strings replace malformed UTF-8
 * with U+FFFD and can collapse two distinct paths into one map key.
 */
const PATH_UTF8 = new TextDecoder('utf-8', { fatal: true });
function visitZRecords(output: Buffer, visit: (record: string) => void): void {
	let start = 0;
	for (let end = 0; end <= output.length; end++) {
		if (end < output.length && output[end] !== 0) continue;
		if (end > start) {
			try {
				visit(PATH_UTF8.decode(output.subarray(start, end)));
			} catch {
				fail(
					'Git returned a pathname that is not valid UTF-8. Rename it before running this report.'
				);
			}
		}
		start = end + 1;
	}
}

function decodeZRecords(output: Buffer): string[] {
	const records: string[] = [];
	visitZRecords(output, (record) => records.push(record));
	return records;
}

function gitZ(args: string[], allowFail = false, timeout?: number): string[] {
	return decodeZRecords(gitBytes(args, allowFail, {}, timeout));
}

function gitZEach(args: string[], visit: (record: string) => void, timeout?: number): void {
	visitZRecords(gitBytes(args, false, {}, timeout), visit);
}

function historyGitBytes(args: string[]): Buffer {
	if (historyOperationsRemaining <= 0) throw new Error('local history operation limit reached');
	historyOperationsRemaining--;
	try {
		const output = execFileSync('git', [...PINNED_CONFIG, ...args], {
			env: gitRunEnv(),
			maxBuffer: MAX_GIT_OUTPUT,
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: HISTORY_COMMAND_TIMEOUT_MS
		});
		ensureScratchIndexExists();
		return output;
	} catch (err) {
		ensureScratchIndexExists();
		throw err;
	}
}

function historyGit(args: string[]): string {
	return historyGitBytes(args).toString('utf8').trim();
}

function historyGitZ(args: string[]): string[] {
	return decodeZRecords(historyGitBytes(args));
}

/**
 * A remote URL can carry a token (https://<PAT>@github.com/owner/repo.git).
 * Every URL here exists to be compared or printed, so it is redacted before it
 * reaches a terminal, an agent transcript or a CI log.
 */
const redactUrl = (u: string) =>
	u
		.replace(/(^[a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1***@')
		.replace(/^[^/@:]+@([^:]+:)/, '***@$1')
		.replace(/\?[\s\S]*$/, '?***')
		.replace(/#[\s\S]*$/, '#***');

const OUTPUT_CONTROL = /[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g;
const escapeOutputControls = (value: string) =>
	value.replace(
		OUTPUT_CONTROL,
		(control) => `\\u${control.charCodeAt(0).toString(16).padStart(4, '0')}`
	);
const terminalSafe = (value: string) => escapeOutputControls(JSON.stringify(value).slice(1, -1));
const terminalUrl = (value: string) => terminalSafe(redactUrl(value));

// A prefix of its own, so a leftover copy is distinguishable from the temp
// repositories the integration tests build under the same directory.
const SCRATCH_PREFIX = 'upstream-relevance-index-';
const SCRATCH_MANIFEST = '.upstream-relevance-scratch.json';
const SCRATCH_MAGIC = 'upstream-relevance-scratch';
const SCRATCH_VERSION = 1;

interface PathIdentity {
	path: string;
	dev: number;
	ino: number;
}

interface LocalRemoteSnapshot {
	root: string;
	endpointPath: string;
	transportPath: string;
	identities: PathIdentity[];
}

// Set once the real index has been copied aside; see the GIT_INDEX_FILE note.
let scratchIndex: string | undefined;
let scratchShallow: string | undefined;
let scratchDir: string | undefined;
let scratchIdentity: PathIdentity | undefined;
let transportGitDir: string | undefined;
let transportConfigPath: string | undefined;
let transportObjectDir: string | undefined;
let transportShallow: string | undefined;
let ownedRepositoryPaths: Set<string> | undefined;
interface RemoteProxySettings {
	url?: string;
	proxy?: string;
	proxyAuthMethod?: string;
}

const transportRemotes = new Map<string, string>();
const localRemoteSnapshots = new Map<string, LocalRemoteSnapshot>();
const transportProxyByUrl = new Map<string, RemoteProxySettings>();
const transportProtocolPolicies = new Map<string, string>();
const transportEnvironmentConfig: Array<[string, string]> = [];
let transportConfigurationAtCopy: Buffer | null = null;
const validatedTransportUrls = new Map<string, string>();
let callerIndexPath: string | undefined;
let callerShallowPath: string | undefined;
let callerIndexAtCopy: Buffer | null = null;
let callerShallowAtCopy: Buffer | null = null;
let scratchShallowAtCopy: Buffer | null = null;
let scratchIndexEntriesAtCopy: Buffer | null = null;

/** An hour is far longer than a run and far shorter than a working day. */
const LEFTOVER_AFTER_MS = 60 * 60 * 1000;

function scratchOwner(dir: string): number | null {
	try {
		const directory = lstatSync(dir);
		if (!directory.isDirectory()) return null;
		if (process.platform !== 'win32' && (directory.mode & 0o077) !== 0) return null;
		const manifest = JSON.parse(readFileSync(join(dir, SCRATCH_MANIFEST), 'utf8')) as {
			magic?: unknown;
			version?: unknown;
			owner?: unknown;
		};
		const legacyOwner = Number(readFileSync(join(dir, 'owner'), 'utf8'));
		if (
			manifest.magic !== SCRATCH_MAGIC ||
			manifest.version !== SCRATCH_VERSION ||
			!Number.isInteger(manifest.owner) ||
			manifest.owner !== legacyOwner ||
			legacyOwner <= 0
		) {
			return null;
		}
		return legacyOwner;
	} catch {
		return null;
	}
}

function sweepLeftovers(tempRoot: string): void {
	// Whatever ended the last run, its copy is still here. Anything younger than
	// an hour may belong to a run happening right now.
	let names: string[];
	try {
		names = readdirSync(tempRoot);
	} catch {
		return;
	}
	for (const name of names) {
		if (!name.startsWith(SCRATCH_PREFIX)) continue;
		try {
			const dir = join(tempRoot, name);
			if (
				ownedRepositoryPaths &&
				pathResolvesInsideOwnedRoot(realpathSync(dir), ownedRepositoryPaths)
			) {
				continue;
			}
			if (Date.now() - statSync(dir).mtimeMs < LEFTOVER_AFTER_MS) continue;
			const owner = scratchOwner(dir);
			if (owner === null) continue;
			try {
				process.kill(owner, 0);
				continue;
			} catch {
				// The owning process is gone; this directory is abandoned.
			}
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Another report may remove its directory between listing and inspection.
		}
	}
}

function ensureScratchIndexExists(): void {
	if (!scratchIndex) return;
	if (!existsSync(scratchIndex)) {
		fail('The private scratch index disappeared during this report. Run it again.');
	}
	if (scratchShallow && !existsSync(scratchShallow)) {
		fail('The private shallow snapshot disappeared during this report. Run it again.');
	}
	if (
		scratchShallow &&
		scratchShallowAtCopy &&
		!readFileSync(scratchShallow).equals(scratchShallowAtCopy)
	) {
		fail('The private shallow snapshot changed during this report. Run it again.');
	}
}

function verifyScratchIndexEntries(): void {
	if (!scratchIndexEntriesAtCopy) return;
	ensureScratchIndexExists();
	const current = gitBytes(['ls-files', '--stage', '-z']);
	if (!current.equals(scratchIndexEntriesAtCopy)) {
		fail('The private scratch index entries changed during this report. Run it again.');
	}
}

function indexHasSplitLink(index: Buffer, hashLength: number): boolean {
	if (index.length < 12 + hashLength || index.subarray(0, 4).toString('ascii') !== 'DIRC') {
		fail('The Git index has an unreadable header.');
	}
	const version = index.readUInt32BE(4);
	if (version < 2 || version > 4) fail(`Git index version ${version} is not supported.`);
	const entries = index.readUInt32BE(8);
	let offset = 12;
	for (let i = 0; i < entries; i++) {
		const start = offset;
		const fixed = 40 + hashLength;
		if (offset + fixed + 2 > index.length - hashLength)
			fail('The Git index entry table is truncated.');
		offset += fixed;
		const flags = index.readUInt16BE(offset);
		offset += 2;
		if ((flags & 0x4000) !== 0) offset += 2;
		if (version === 4) {
			while (offset < index.length && (index[offset++]! & 0x80) !== 0) {
				// Skip the pathname-prefix varint. Only its end matters here.
			}
		}
		const nul = index.indexOf(0, offset);
		if (nul < 0 || nul >= index.length - hashLength)
			fail('The Git index pathname table is truncated.');
		offset = nul + 1;
		if (version < 4) while ((offset - start) % 8 !== 0) offset++;
	}
	const checksum = index.length - hashLength;
	while (offset + 8 <= checksum) {
		const signature = index.subarray(offset, offset + 4).toString('ascii');
		const size = index.readUInt32BE(offset + 4);
		offset += 8;
		if (offset + size > checksum) fail('The Git index extension table is truncated.');
		if (signature === 'link') return true;
		offset += size;
	}
	return false;
}

function useScratchIndex(root: string): void {
	if (!isAbsolute(TEMP_ROOT)) {
		fail(
			'The system temporary directory must be an absolute path. Refusing to write inside the repository.'
		);
	}
	let rootPath: string;
	let tempPath: string;
	let commonPath: string;
	let gitPath: string;
	let objectPath: string;
	try {
		rootPath = realpathSync(root);
		tempPath = realpathSync(TEMP_ROOT);
		commonPath = realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
		gitPath = realpathSync(git(['rev-parse', '--path-format=absolute', '--git-dir']));
		objectPath = realpathSync(
			git(['rev-parse', '--path-format=absolute', '--git-path', 'objects'])
		);
	} catch {
		fail('The system temporary directory or Git storage is not readable.');
	}
	const ownedRoots = new Set([rootPath, commonPath, gitPath]);
	const worktreeFields = decodeZRecords(gitBytes(['worktree', 'list', '--porcelain', '-z'])).filter(
		(field) => field.startsWith('worktree ')
	);
	if (worktreeFields.length === 0) {
		fail('Git did not identify any checkout for this repository.');
	}
	for (const field of worktreeFields) {
		let worktreePath: string;
		try {
			worktreePath = realpathSync(field.slice('worktree '.length));
		} catch {
			fail(
				'Git listed a checkout whose path is not readable. Prune stale worktrees, then try again.'
			);
		}
		if (worktreePath === commonPath) {
			const configured = git(['config', '--get', 'core.worktree'], true);
			if (!configured) {
				fail(
					'Git cannot identify the primary checkout for this separate Git directory. ' +
						'Configure core.worktree before running the report from a linked worktree.'
				);
			}
			worktreePath = realpathSync(
				isAbsolute(configured) ? configured : resolve(commonPath, configured)
			);
		}
		ownedRoots.add(worktreePath);
		try {
			ownedRoots.add(
				realpathSync(git(['-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-dir']))
			);
		} catch {
			fail("Git could not identify the storage for one of this repository's checkouts.");
		}
	}
	ownedRepositoryPaths = new Set(ownedRoots);
	const insideOwnedRoot = pathResolvesInsideOwnedRoot(tempPath, ownedRoots);
	if (insideOwnedRoot) {
		fail(
			'The system temporary directory resolves inside this repository or its shared Git storage. Refusing to write or sweep it.'
		);
	}
	sweepLeftovers(tempPath);
	const realIndex = git(['rev-parse', '--git-path', 'index'], true);
	if (!realIndex || !existsSync(realIndex)) {
		fail(
			'Upstream relevance requires an existing Git index to snapshot. Restore the index, then run the report again.'
		);
	}
	callerIndexPath = realIndex;
	const indexAtCopy = readFileSync(realIndex);
	callerIndexAtCopy = indexAtCopy;
	callerShallowPath = git(['rev-parse', '--git-path', 'shallow'], true) || undefined;
	const shallowAtCopy = optionalFile(callerShallowPath);
	callerShallowAtCopy = shallowAtCopy;
	const objectFormat = git(['rev-parse', '--show-object-format'], true);
	const hashLength = objectFormat === 'sha256' ? 32 : 20;
	if (indexHasSplitLink(indexAtCopy, hashLength)) {
		fail(
			'Upstream relevance cannot read a split index without touching its shared backing file. ' +
				'Disable core.splitIndex, then run the report again.'
		);
	}
	scratchDir = mkdtempSync(join(tempPath, SCRATCH_PREFIX));
	chmodSync(scratchDir, 0o700);
	scratchIdentity = pathIdentity(scratchDir);
	writeFileSync(join(scratchDir, 'owner'), String(process.pid), { mode: 0o600 });
	writeFileSync(
		join(scratchDir, SCRATCH_MANIFEST),
		JSON.stringify({ magic: SCRATCH_MAGIC, version: SCRATCH_VERSION, owner: process.pid }),
		{ mode: 0o600 }
	);
	transportGitDir = join(scratchDir, 'transport.git');
	transportObjectDir = objectPath;
	transportShallow = join(scratchDir, 'transport-shallow');
	mkdirSync(join(transportGitDir, 'objects'), { recursive: true });
	mkdirSync(join(transportGitDir, 'refs'));
	writeFileSync(join(transportGitDir, 'HEAD'), 'ref: refs/heads/transport\n');
	transportConfigPath = join(transportGitDir, 'config');
	writeFileSync(
		transportConfigPath,
		objectFormat === 'sha256'
			? '[core]\nrepositoryformatversion = 1\nbare = true\n[extensions]\nobjectFormat = sha256\n'
			: '[core]\nrepositoryformatversion = 0\nbare = true\n'
	);
	chmodSync(transportConfigPath, 0o600);
	copyTransportConfiguration(transportConfigPath);
	writeFileSync(transportShallow, Buffer.alloc(0));
	const copy = join(scratchDir, 'index');
	writeFileSync(copy, indexAtCopy);
	scratchIndex = copy;
	scratchShallow = join(scratchDir, 'shallow');
	scratchShallowAtCopy = shallowAtCopy ?? Buffer.alloc(0);
	writeFileSync(scratchShallow, scratchShallowAtCopy);
	scratchIndexEntriesAtCopy = gitBytes(['ls-files', '--stage', '-z']);
}

function dropScratchIndex(): void {
	try {
		if (
			scratchDir &&
			scratchIdentity &&
			samePathIdentity(scratchIdentity, pathIdentity(scratchDir)) &&
			scratchOwner(scratchDir) === process.pid
		) {
			rmSync(scratchDir, { recursive: true, force: true });
		}
	} catch {
		// A path that no longer names our directory is left untouched.
	}
	scratchDir = undefined;
	scratchIdentity = undefined;
	scratchIndex = undefined;
	scratchShallow = undefined;
	transportGitDir = undefined;
	transportConfigPath = undefined;
	transportObjectDir = undefined;
	transportShallow = undefined;
	ownedRepositoryPaths = undefined;
	transportRemotes.clear();
	localRemoteSnapshots.clear();
	transportProxyByUrl.clear();
	transportProtocolPolicies.clear();
	transportEnvironmentConfig.length = 0;
	transportConfigurationAtCopy = null;
	validatedTransportUrls.clear();
	callerIndexPath = undefined;
	callerShallowPath = undefined;
	callerIndexAtCopy = null;
	callerShallowAtCopy = null;
	scratchShallowAtCopy = null;
	scratchIndexEntriesAtCopy = null;
}

function fail(message: string): never {
	console.error(message);
	process.exit(3);
}

export type Relevance = 'pristine' | 'diverged' | 'unmeasured';

export interface FileVerdict {
	path: string;
	relevance: Relevance;
	/** Fraction of the changed region that exists in the upstream copy. */
	overlap?: number;
	/** Why nothing could be measured, when relevance is `unmeasured`. */
	note?: string;
	/** Whether this file is worth a human or agent look. */
	report: boolean;
}

/** One hunk's worth of evidence about where a change landed. */
interface Region {
	removed: string[];
	context: string[];
}

/**
 * One region per hunk, describing WHERE that hunk landed: everything it
 * removed, plus the context git kept around it.
 *
 * Per hunk and not per file, because the two kinds of hunk are scored by
 * different evidence (see regionOverlap) and pooling them lets one erase the
 * other: a file that removes a fork-only call in one place and inserts a guard
 * beside template code in another scored purely on the fork-only removal, which
 * sorted the most upstream-shaped file in the branch to the bottom.
 * Added lines are excluded on purpose. They are by
 * definition absent upstream, so counting them would drive every overlap toward
 * zero and hide exactly the pristine-file edits this is meant to catch.
 *
 * Only lines inside a hunk are read, so the `---`/`+++` file headers are
 * already excluded by position. They are deliberately NOT filtered by prefix: a
 * removed line whose own content starts with `--` reaches the parser as
 * `---content`, and skipping it discards the only evidence a one-line change
 * has.
 */
export function changedRegionLines(unifiedDiff: string): Region[] {
	const regions: Region[] = [];
	let current: Region | null = null;
	for (const line of unifiedDiff.split('\n')) {
		if (line.startsWith('@@')) {
			current = { removed: [], context: [] };
			regions.push(current);
			continue;
		}
		if (!current) continue;
		if (line.startsWith('-')) current.removed.push(line.slice(1));
		else if (line.startsWith(' ')) current.context.push(line.slice(1));
	}
	return regions;
}

/**
 * How much of a changed region still exists in the upstream copy of the file.
 *
 * Compared as a multiset of trimmed lines, so reindentation and moved code do
 * not read as divergence. Blank lines and single-character lines (a lone brace)
 * are dropped: they match everywhere and would inflate every score toward 1.
 *
 * Returns null when nothing comparable remains, which the caller must treat as
 * "not measured" and never as an overlap of zero.
 */
export function regionOverlap(regions: Region[], upstreamContent: string): number | null {
	return regionOverlapWithLines(regions, countLines(upstreamContent));
}

function regionOverlapWithLines(regions: Region[], available: Map<string, number>): number | null {
	let best: number | null = null;
	for (const region of regions) {
		const score = hunkOverlap(region, available);
		if (score !== null && (best === null || score > best)) best = score;
	}
	return best;
}

/** Trimmed, meaningful lines of a file with their multiplicities. */
function countLines(content: string): Map<string, number> {
	const available = new Map<string, number>();
	for (const line of content.split('\n')) {
		const t = line.trim();
		if (!meaningful(t)) continue;
		available.set(t, (available.get(t) ?? 0) + 1);
	}
	return available;
}

function lineRepresentationCost(content: string): number {
	let cost = 0;
	let start = 0;
	while (start <= content.length) {
		const newline = content.indexOf('\n', start);
		const end = newline === -1 ? content.length : newline;
		const line = content.slice(start, end).trim();
		// countLines materializes one split entry per line, including entries that
		// are too short to compare. Charge each slot before allocating the array.
		cost += 32 + line.length;
		if (newline === -1) break;
		start = newline + 1;
	}
	return cost;
}

function bagRepresentationCost(content: string): number {
	let lines = 0;
	let joinedLength = 0;
	let start = 0;
	while (start <= content.length) {
		const newline = content.indexOf('\n', start);
		const end = newline === -1 ? content.length : newline;
		const line = content.slice(start, end).trim();
		if (meaningful(line)) {
			if (lines > 0) joinedLength++;
			lines++;
			joinedLength += line.length;
		}
		if (newline === -1) break;
		start = newline + 1;
	}
	const grams = Math.max(0, joinedLength - GRAM_WIDTH + 1);
	return lines * 32 + grams * Uint32Array.BYTES_PER_ELEMENT;
}

function bagOf(content: string): Bag {
	const lines = countLines(content);
	let total = 0;
	for (const count of lines.values()) total += count;
	const kept = content
		.split('\n')
		.map((line) => line.trim())
		.filter(meaningful);
	return { lines, total, ...(kept.length > 0 ? { grams: characterGrams(kept.join('\n')) } : {}) };
}

const meaningful = (s: string) => s.trim().length > 1;

function hunkOverlap(region: Region, upstreamLines: Map<string, number>): number | null {
	const removed = region.removed.map((l) => l.trim()).filter(meaningful);
	const context = region.context.map((l) => l.trim()).filter(meaningful);
	// Removed lines say what this change actually replaced, so they decide the
	// verdict on their own whenever there are any. Mixing context in dilutes
	// them: a one-line fix to template code carries six lines of surrounding
	// fork-only context, and averaging the seven buries the one line that is
	// the entire finding. Context is used only for a pure insertion, where
	// there is nothing else to go on.
	const lines = removed.length > 0 ? removed : context;
	if (lines.length === 0) return null;

	// Count only lines this hunk uses. Cloning the complete upstream tally for
	// every hunk turns a sparse diff into a hunk-by-file cross-product.
	const used = new Map<string, number>();
	let hits = 0;
	for (const line of lines) {
		const count = (used.get(line) ?? 0) + 1;
		used.set(line, count);
		if (count <= (upstreamLines.get(line) ?? 0)) hits++;
	}
	return hits / lines.length;
}

export function classifyVerdict(args: {
	path: string;
	existsUpstream: boolean;
	baseMatchesUpstream: boolean;
	overlap?: number | null;
	unmeasuredNote?: string;
}): FileVerdict {
	if (!args.existsUpstream) {
		return {
			path: args.path,
			relevance: 'unmeasured',
			note: args.unmeasuredNote ?? 'no upstream path, but fork ownership is not proven',
			report: true
		};
	}
	if (args.baseMatchesUpstream) return { path: args.path, relevance: 'pristine', report: true };
	if (args.overlap === null || args.overlap === undefined) {
		return {
			path: args.path,
			relevance: 'unmeasured',
			note: args.unmeasuredNote ?? 'no comparable text in the change',
			report: true
		};
	}
	return { path: args.path, relevance: 'diverged', overlap: args.overlap, report: true };
}

interface MarkerSnapshot {
	url: string;
	bytes: Buffer | null;
	provenance: string[];
}

function markerSnapshotFromBytes(bytes: Buffer): MarkerSnapshot {
	let raw: string;
	try {
		raw = PATH_UTF8.decode(bytes);
	} catch {
		fail(`${MARKER} is not valid UTF-8.`);
	}
	try {
		const marker: unknown = JSON.parse(raw);
		if (!marker || Array.isArray(marker) || typeof marker !== 'object') {
			fail(`${MARKER} must contain a JSON object.`);
		}
		const fields = marker as {
			upstreamUrl?: unknown;
			forkPoint?: unknown;
			lastSynced?: unknown;
		};
		const upstreamUrl = fields.upstreamUrl;
		if (upstreamUrl !== undefined && (typeof upstreamUrl !== 'string' || !upstreamUrl.trim())) {
			fail(`${MARKER}.upstreamUrl must be a non-empty string when present.`);
		}
		const provenanceFields = [fields.forkPoint, fields.lastSynced];
		if (
			provenanceFields.some(
				(value) =>
					value !== undefined &&
					(typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value))
			)
		) {
			fail(`${MARKER}.forkPoint and .lastSynced must be full commit SHAs when present.`);
		}
		const provenance = provenanceFields.filter(
			(value): value is string => typeof value === 'string'
		);
		return { url: upstreamUrl ?? DEFAULT_UPSTREAM, bytes, provenance };
	} catch (err) {
		if (err instanceof SyntaxError) {
			fail(
				`${MARKER} is not valid JSON: ${terminalSafe(err.message)}\n` +
					'Refusing to fall back to the default template. That would classify this fork ' +
					'against the wrong repository and every verdict would look normal.'
			);
		}
		throw err;
	}
}

function indexMarkerBytes(): Buffer | null {
	const staged = git(['ls-files', '--stage', '--', `:(literal)${MARKER}`], true);
	if (!staged) return null;
	const mode = /^(\d{6}) [0-9a-f]+ 0\t/.exec(staged)?.[1];
	if (mode !== '100644' && mode !== '100755') {
		fail(`${MARKER} must be a regular file. Symlinks cannot bind a repository to its parent.`);
	}
	const size = Number(git(['cat-file', '-s', `:${MARKER}`], false, HISTORY_COMMAND_TIMEOUT_MS));
	if (!Number.isFinite(size) || size > MAX_MARKER_BYTES) {
		fail(`${MARKER} exceeds the ${MAX_MARKER_BYTES}-byte input limit.`);
	}
	return gitBytes(['show', `:${MARKER}`], false, {}, HISTORY_COMMAND_TIMEOUT_MS);
}

function readUpstreamMarker(root: string): MarkerSnapshot {
	if (WINDOWS_SAFETY_MODE) {
		const bytes = indexMarkerBytes();
		return bytes === null
			? { url: DEFAULT_UPSTREAM, bytes: null, provenance: [] }
			: markerSnapshotFromBytes(bytes);
	}
	const p = join(root, MARKER);
	// Open first and bind inspection plus reading to one descriptor. An atomic
	// replacement between lstat and read used to select a different parent, then
	// leave its remote and tracking ref behind when the final snapshot aborted.
	let fd: number;
	try {
		fd = openSync(
			p,
			fsConstants.O_RDONLY |
				(WINDOWS_SAFETY_MODE ? 0 : (fsConstants.O_NOFOLLOW ?? 0)) |
				(fsConstants.O_NONBLOCK ?? 0)
		);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			return { url: DEFAULT_UPSTREAM, bytes: null, provenance: [] };
		}
		if (code === 'ELOOP') {
			fail(`${MARKER} must be a regular file. Symlinks cannot bind a repository to its parent.`);
		}
		fail(
			`${MARKER} could not be opened: ${terminalSafe(
				err instanceof Error ? err.message : String(err)
			)}`
		);
	}
	let bytes: Buffer;
	try {
		const opened = fstatSync(fd);
		const atPath = lstatSync(p);
		if (!opened.isFile() || !atPath.isFile() || !sameFileIdentity(opened, atPath)) {
			fail(
				`${MARKER} must be one stable regular file. Symlinks cannot bind a repository to its parent.`
			);
		}
		if (opened.size > MAX_MARKER_BYTES) {
			fail(`${MARKER} exceeds the ${MAX_MARKER_BYTES}-byte input limit.`);
		}
		bytes = Buffer.allocUnsafe(opened.size);
		let total = 0;
		while (total < bytes.length) {
			const read = readSync(fd, bytes, total, bytes.length - total, total);
			if (read === 0) break;
			total += read;
		}
		const afterRead = fstatSync(fd);
		const afterPath = lstatSync(p);
		if (
			total !== opened.size ||
			afterRead.size !== opened.size ||
			afterRead.mtimeMs !== opened.mtimeMs ||
			afterRead.ctimeMs !== opened.ctimeMs ||
			!afterPath.isFile() ||
			!sameFileIdentity(opened, afterPath)
		) {
			fail(`${MARKER} changed while it was read. Run the report again on the settled file.`);
		}
	} catch (err) {
		fail(
			`${MARKER} exists but could not be read: ${terminalSafe(
				err instanceof Error ? err.message : String(err)
			)}`
		);
	} finally {
		closeSync(fd);
	}
	return markerSnapshotFromBytes(bytes);
}

function requireCleanUpstreamMarker(marker: MarkerSnapshot): void {
	rejectHiddenIndexEntries([MARKER]);
	const literalMarker = `:(literal)${MARKER}`;
	const tracked = gitZ(['ls-files', '-z', '--', literalMarker]).includes(MARKER);
	const ignored = gitZ([
		'ls-files',
		'--others',
		'--ignored',
		'--exclude-standard',
		'-z',
		'--',
		literalMarker
	]).includes(MARKER);
	if (ignored || (marker.bytes !== null && !tracked)) {
		fail(
			`${MARKER} exists but is not tracked. Commit it before upstream relevance selects a parent.`
		);
	}
	const status = gitBytes(
		['status', '--porcelain=v2', '-z', '--untracked-files=all', '--', `:(literal)${MARKER}`],
		false,
		{},
		WORKTREE_TIMEOUT_MS
	);
	if (status.length === 0) return;
	fail(
		`${MARKER} must be committed and clean before upstream relevance can select a parent. ` +
			'Commit or restore it, then run the report again.'
	);
}

function requireMarkerAtHead(head: string, marker: MarkerSnapshot): void {
	const type = git(['cat-file', '-t', `${head}:${MARKER}`], true);
	if (marker.bytes === null) {
		if (!type) return;
		fail(`${MARKER} appeared or disappeared while the report selected its parent.`);
	}
	if (type !== 'blob') {
		fail(`${MARKER} does not match the committed file at HEAD.`);
	}
	const size = Number(git(['cat-file', '-s', `${head}:${MARKER}`]));
	if (!Number.isFinite(size) || size > MAX_MARKER_BYTES) {
		fail(`${MARKER} exceeds the ${MAX_MARKER_BYTES}-byte input limit at HEAD.`);
	}
	const committed = gitBytes(['show', `${head}:${MARKER}`]);
	if (!committed.equals(marker.bytes)) {
		fail(
			`${MARKER} changed while the report selected its parent. Run it again on the settled file.`
		);
	}
}

// Compare the server address Git will actually use. Credentials do not identify
// an HTTPS repository; transport syntax, path roots, trailing suffixes and SSH
// users do. Servers are free to map each of those to different repositories.
function normalizeRemote(u: string): string {
	return u.replace(/^(https?:\/\/)[^/?#]*@/i, '$1');
}

function githubRepository(u: string): string | null {
	const url = normalizeRemote(u);
	const match =
		/^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/?$/i.exec(url) ??
		/^git@github\.com:([^/?#]+)\/([^/?#]+)\/?$/i.exec(url) ??
		/^ssh:\/\/git@github\.com\/([^/?#]+)\/([^/?#]+)\/?$/i.exec(url);
	if (!match) return null;
	const repository = match[2]!.replace(/\.git$/i, '');
	return repository ? `${match[1]!.toLowerCase()}/${repository.toLowerCase()}` : null;
}

function sameRepository(left: string, right: string): boolean {
	if (normalizeRemote(left) === normalizeRemote(right)) return true;
	const leftGithub = githubRepository(left);
	return leftGithub !== null && leftGithub === githubRepository(right);
}

function localRemotePath(url: string, root: string): string | null {
	let candidate: string;
	if (/^[\\/]{2}[^\\/]/.test(url)) {
		fail('UNC paths are network transports and are not accepted as local upstream evidence.');
	}
	if (WINDOWS_SAFETY_MODE && /^[a-z]:(?![\\/])/i.test(url)) {
		fail(
			'Windows drive-relative paths are not accepted as upstream evidence. Use an absolute path.'
		);
	}
	if (/^file:/i.test(url)) {
		try {
			const parsed = new URL(url);
			if (parsed.hostname !== '') {
				fail(
					'Hosted file URLs are network transports and are not accepted as local upstream evidence.'
				);
			}
			candidate = fileURLToPath(parsed);
		} catch {
			fail(
				`Cannot trust ${terminalUrl(url)} because its file URL cannot be resolved to one canonical local path.`
			);
		}
	} else if (isAbsolute(url)) {
		candidate = url;
	} else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^(?:[^/\\]+@)?[^/\\:]+:.+/.test(url)) {
		return null;
	} else {
		candidate = resolve(root, url);
	}
	try {
		return realpathSync(candidate);
	} catch {
		fail(
			`Cannot trust ${terminalUrl(url)} because its local path cannot be resolved to one canonical location.`
		);
	}
}

function localGitPath(remotePath: string, args: string[], allowFail = false): string | null {
	try {
		const env = gitEnv();
		env.GIT_CONFIG_NOSYSTEM = '1';
		env.GIT_CONFIG_GLOBAL = NO_GRAFTS;
		env.GIT_CONFIG_SYSTEM = NO_GRAFTS;
		env.GIT_GRAFT_FILE = NO_GRAFTS;
		env.GIT_NO_REPLACE_OBJECTS = '1';
		const value = execFileSync('git', [...PINNED_CONFIG, ...args], {
			cwd: remotePath,
			env,
			maxBuffer: MAX_GIT_OUTPUT,
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: WORKTREE_TIMEOUT_MS
		}).toString('utf8');
		return value.endsWith('\n') ? value.slice(0, -1) : value;
	} catch {
		if (allowFail) return null;
		fail('A local upstream path does not resolve to stable Git storage.');
	}
}

const MAX_ALTERNATE_DEPTH = 5;

function addAlternateObjectStores(
	objectDir: string,
	effectivePaths: Set<string>,
	seen: Set<string>,
	depth: number
): void {
	const canonical = realpathSync(objectDir);
	if (seen.has(canonical)) return;
	seen.add(canonical);
	effectivePaths.add(canonical);
	const alternatesPath = join(canonical, 'info', 'alternates');
	if (!existsSync(alternatesPath)) return;
	const alternates = readFileSync(alternatesPath, 'utf8')
		.split('\n')
		.map((alternate) => alternate.replace(/\r$/, ''))
		.filter(Boolean);
	if (alternates.length === 0 || depth + 1 > MAX_ALTERNATE_DEPTH) return;
	for (const alternate of alternates) {
		addAlternateObjectStores(
			isAbsolute(alternate) ? alternate : resolve(canonical, alternate),
			effectivePaths,
			seen,
			depth + 1
		);
	}
}

function inspectLocalRemote(
	url: string,
	root: string,
	remote: string,
	validatedEndpoint?: string
): LocalRemoteSnapshot | null {
	const remotePath = validatedEndpoint ?? localRemotePath(url, root);
	if (!remotePath) return null;
	if (!ownedRepositoryPaths) {
		fail('The repository checkout inventory is unavailable. Run the report again.');
	}
	const endpoint = statSync(remotePath);
	let transportPath = remotePath;
	const effectivePaths = new Set([remotePath]);
	if (endpoint.isDirectory()) {
		const gitDirValue = localGitPath(remotePath, [
			'rev-parse',
			'--path-format=absolute',
			'--git-dir'
		]);
		const commonDirValue = localGitPath(remotePath, [
			'rev-parse',
			'--path-format=absolute',
			'--git-common-dir'
		]);
		const objectDirValue = localGitPath(remotePath, [
			'rev-parse',
			'--path-format=absolute',
			'--git-path',
			'objects'
		]);
		if (!gitDirValue || !commonDirValue || !objectDirValue) {
			fail('A local upstream path does not identify complete Git storage.');
		}
		const gitDir = realpathSync(gitDirValue);
		const commonDir = realpathSync(commonDirValue);
		const objectDir = realpathSync(objectDirValue);
		effectivePaths.add(gitDir);
		effectivePaths.add(commonDir);
		effectivePaths.add(objectDir);
		const worktreeValue = localGitPath(
			remotePath,
			['rev-parse', '--path-format=absolute', '--show-toplevel'],
			true
		);
		if (worktreeValue) effectivePaths.add(realpathSync(worktreeValue));
		const alternateStores = new Set([objectDir]);
		const alternatesPath = join(objectDir, 'info', 'alternates');
		if (existsSync(alternatesPath)) {
			for (const alternate of readFileSync(alternatesPath, 'utf8').split('\n')) {
				const path = alternate.replace(/\r$/, '');
				if (!path) continue;
				addAlternateObjectStores(
					isAbsolute(path) ? path : resolve(objectDir, path),
					effectivePaths,
					alternateStores,
					0
				);
			}
		}
		// The common directory names refs directly. Keeping the wrapper worktree out
		// of the transport removes its mutable .git indirection from later Git calls.
		transportPath = commonDir;
	} else if (!endpoint.isFile()) {
		fail('A local upstream path must name a Git directory or bundle file.');
	}
	for (const path of effectivePaths) {
		if (!pathResolvesInsideOwnedRoot(path, ownedRepositoryPaths)) continue;
		fail(
			`The ${remote} URL resolves inside a checkout or Git directory owned by this repository. ` +
				'A repository-owned remote can follow branch-controlled refs and hide every committed change.'
		);
	}
	return {
		root,
		endpointPath: remotePath,
		transportPath,
		identities: identityChains(effectivePaths)
	};
}

function verifyLocalRemoteSnapshot(url: string): void {
	const expected = localRemoteSnapshots.get(url);
	if (!expected) return;
	let current: LocalRemoteSnapshot | null;
	try {
		current = inspectLocalRemote(url, expected.root, 'local remote', expected.endpointPath);
	} catch {
		fail('A local upstream path or one of its ancestors changed during this report. Run it again.');
	}
	if (
		!current ||
		current.transportPath !== expected.transportPath ||
		!sameIdentityChains(current.identities, expected.identities)
	) {
		fail('A local upstream path or one of its ancestors changed during this report. Run it again.');
	}
}

function rejectOwnedRepositoryRemote(url: string, root: string, remote: string): void {
	let snapshot: LocalRemoteSnapshot | null;
	try {
		snapshot = inspectLocalRemote(url, root, remote);
	} catch {
		fail(`Cannot trust the ${remote} URL because its local Git storage cannot be resolved.`);
	}
	if (!snapshot) {
		localRemoteSnapshots.delete(url);
		validatedTransportUrls.set(url, url);
		return;
	}
	localRemoteSnapshots.set(url, snapshot);
	validatedTransportUrls.set(url, snapshot.transportPath);
}

function rejectUnverifiableFileModes(): void {
	if (process.platform === 'win32') return;
	if (gitUnpinned(['config', '--bool', '--get', 'core.fileMode'], true) === 'true') return;
	fail(
		'Git reports that this filesystem does not preserve executable bits. ' +
			'The report cannot verify mode-only changes here.'
	);
}

function rejectUnsafePartialClone(): void {
	const promisor = git(['config', '--bool', '--get-regexp', '^remote\\..*\\.promisor$'], true)
		.split('\n')
		.some((line) => /\s+true$/i.test(line));
	const partialClone = git(['config', '--get', 'extensions.partialClone'], true);
	if (!promisor && !partialClone) return;
	const match = /^git version (\d+)\.(\d+)/.exec(git(['version']));
	const supportsNoLazyFetch =
		match !== null && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 45));
	if (!supportsNoLazyFetch) {
		fail(
			'Git 2.45 or newer is required for a partial-clone report. Older Git can lazily fetch missing objects during a no-fetch run.'
		);
	}
}

function configuredRemoteUrl(remote: string): string {
	const urls = decodeZRecords(
		gitBytes(['config', '--null', '--get-all', `remote.${remote}.url`], true)
	);
	if (urls.length > 1) {
		fail(
			`The \`${remote}\` remote has multiple fetch URLs. Keep one URL before running this report.`
		);
	}
	return urls[0] ?? '';
}

function rejectTransportCommandOverrides(): void {
	const output = gitBytes(
		['config', '--null', '--get-regexp', '^(core\\.sshcommand|core\\.gitproxy)$'],
		true
	);
	for (const record of decodeZRecords(output)) {
		const newline = record.indexOf('\n');
		if (newline === -1) continue;
		const key = record.slice(0, newline);
		const value = record.slice(newline + 1).trim();
		if (!value || (key.toLowerCase() === 'core.gitproxy' && /^none(?:\\s|$)/i.test(value))) {
			continue;
		}
		const displayKey =
			key.toLowerCase() === 'core.sshcommand' ? 'core.sshCommand' : 'core.gitProxy';
		fail(
			`Git transport command override ${displayKey} is active. ` +
				'Remove it before trusting remote evidence.'
		);
	}
}

function rejectUrlRewrite(url: string): void {
	const output = gitBytes(['config', '--null', '--get-regexp', '^url\\..*\\.insteadof$'], true);
	for (const record of decodeZRecords(output)) {
		const newline = record.indexOf('\n');
		if (newline === -1) continue;
		const replacementKey = record.slice(0, newline);
		const prefix = record.slice(newline + 1);
		if (!prefix || !url.startsWith(prefix)) continue;
		const replacement = replacementKey.slice('url.'.length, -'.insteadof'.length);
		fail(
			`Git rewrites ${terminalUrl(url)} to ${terminalUrl(replacement)} through url.*.insteadOf. ` +
				'Remove that rewrite before trusting remote evidence.'
		);
	}
}

/**
 * Make `upstream/main` readable without writing anything, unless told to.
 *
 * Three things go wrong here if you let them, and all three end in confident
 * wrong answers instead of errors:
 *
 * 1. `git remote add` and `git fetch` write config and refs that every linked
 *    worktree shares, and the URL comes from a file the branch controls. So
 *    they happen only under --fetch, never as a side effect of asking a
 *    question.
 * 2. An existing `upstream` ref may track a different repository. The name is
 *    conventional, and a parent fork is the usual squatter. Its URL is checked
 *    against the marker before the ref is trusted, because classifying against
 *    the wrong tree produces a complete and plausible set of wrong verdicts.
 * 3. A blobless fetch would set `promisor` and `partialclonefilter` on the
 *    shared remote, so every later upstream blob read needs the network,
 *    including `upstream-sync`'s. Not worth the saved bytes.
 */
interface UpstreamSnapshot {
	sha: string;
	ageDays: number | null;
	ageFrom: string;
	remoteUrl: string;
	/** The tracking tree came from the configured upstream remote or this detector's fetch. */
	identityTrusted: boolean;
	/** Recheck a live advertisement used to bind this snapshot before output. */
	verifyAdvertisedMain: boolean;
	/** Only this run's explicit fetch can support a negative path verdict. */
	absenceTrusted: boolean;
}

interface RefLogEntry {
	sha: string;
	timestamp: number;
	subject: string;
}

function latestRefLogEntry(ref: string): RefLogEntry | null {
	const line = git(['reflog', 'show', '-1', '--date=unix', '--format=%H%x09%gd%x09%gs', ref], true);
	if (!line) return null;
	const [sha = '', selector = '', subject = ''] = line.split('\t');
	const timestamp = Number(/@\{(\d+)\}$/.exec(selector)?.[1] ?? NaN);
	return sha && Number.isFinite(timestamp) ? { sha, timestamp, subject } : null;
}

function remoteFingerprint(url: string): string {
	return createHash('sha256').update(normalizeRemote(url)).digest('hex');
}

function recordedFetchTimestamp(sha: string, url: string): number {
	const value = git(['config', '--get', UPSTREAM_FETCH_CONFIG], true);
	const match = /^([0-9a-f]+) (\d+) ([0-9a-f]{64})$/.exec(value);
	if (!match || match[1] !== sha || match[3] !== remoteFingerprint(url)) return NaN;
	const timestamp = Number(match[2]);
	return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : NaN;
}

function refspecSourceForTarget(refspec: string, target: string): string | null {
	const normalized = refspec.replace(/^\+/, '');
	if (normalized.startsWith('^')) return null;
	const colon = normalized.indexOf(':');
	if (colon === -1) return null;
	const source = normalized.slice(0, colon);
	const destination = normalized.slice(colon + 1);
	const star = destination.indexOf('*');
	if (star === -1) return destination === target ? source : null;
	if (destination.indexOf('*', star + 1) !== -1 || source.split('*').length !== 2) return null;
	const prefix = destination.slice(0, star);
	const suffix = destination.slice(star + 1);
	if (!target.startsWith(prefix) || !target.endsWith(suffix)) return null;
	const middle = target.slice(prefix.length, target.length - suffix.length);
	return source.replace('*', middle);
}

function refPatternMatches(pattern: string, ref: string): boolean {
	const star = pattern.indexOf('*');
	if (star === -1) return pattern === ref;
	if (pattern.indexOf('*', star + 1) !== -1) return false;
	return ref.startsWith(pattern.slice(0, star)) && ref.endsWith(pattern.slice(star + 1));
}

function remoteMainRefspecIsCanonical(remote: string): boolean {
	const refspecs = git(['config', '--get-all', `remote.${remote}.fetch`], true)
		.split('\n')
		.filter(Boolean);
	if (
		refspecs.some((refspec) => {
			const normalized = refspec.replace(/^\+/, '');
			return (
				normalized.startsWith('^') && refPatternMatches(normalized.slice(1), 'refs/heads/main')
			);
		})
	) {
		return false;
	}
	const target = `refs/remotes/${remote}/main`;
	const sources = refspecs
		.map((refspec) => refspecSourceForTarget(refspec, target))
		.filter((source): source is string => source !== null);
	return sources.length > 0 && sources.every((source) => source === 'refs/heads/main');
}

function removeDetectorAddedUpstreamRemote(url: string): boolean {
	const actual = decodeZRecords(
		gitBytes(['config', '--null', '--get-regexp', '^remote\\.upstream\\.'], true)
	).sort();
	const expected = [
		`remote.upstream.fetch\n+refs/heads/*:refs/remotes/upstream/*`,
		`remote.upstream.url\n${url}`
	].sort();
	if (
		actual.length !== expected.length ||
		actual.some((record, index) => record !== expected[index])
	) {
		return false;
	}
	try {
		git(['config', '--remove-section', 'remote.upstream']);
		return configuredRemoteUrl('upstream') === '';
	} catch {
		return false;
	}
}

function cameFromUpstreamMain(entry: RefLogEntry | null, sha: string): boolean {
	if (!entry || entry.sha !== sha) return false;
	const separator = entry.subject.lastIndexOf(': ');
	if (separator === -1) return false;
	const command = entry.subject.slice(0, separator).trim().split(/\s+/);
	if (command[0] !== 'fetch' && command[0] !== 'pull') return false;
	const configuredRemotes = new Set(git(['remote'], true).split('\n').filter(Boolean));
	const namedRemotes = command.slice(1).filter((token) => configuredRemotes.has(token));
	if (namedRemotes.length !== 1 || namedRemotes[0] !== 'upstream') return false;
	const remoteIndex = command.lastIndexOf('upstream');
	const refArguments = command.slice(remoteIndex + 1).filter((token) => !token.startsWith('-'));
	const target = 'refs/remotes/upstream/main';
	const mappedSources = refArguments
		.map((refspec) => refspecSourceForTarget(refspec, target))
		.filter((source): source is string => source !== null);
	if (mappedSources.length > 0) {
		return mappedSources.every((source) => source === 'refs/heads/main');
	}
	if (refArguments.some((ref) => ref === 'main' || ref === 'refs/heads/main')) return true;
	return remoteMainRefspecIsCanonical('upstream');
}

function ensureUpstream(root: string, upstreamUrl: string, allowFetch: boolean): UpstreamSnapshot {
	rejectUnauthenticatedTransport(upstreamUrl);
	rejectSecretBearingRemoteUrl(upstreamUrl);
	rejectOwnedRepositoryRemote(upstreamUrl, root, 'marker upstream');
	const originUrl = configuredRemoteUrl('origin');
	if (originUrl) {
		rejectUrlRewrite(originUrl);
		rejectOwnedRepositoryRemote(originUrl, root, 'origin');
	}
	if (originUrl && sameRepository(originUrl, upstreamUrl)) {
		console.error('This repository IS the upstream template. Nothing to report upstream.');
		process.exit(2);
	}

	let remoteUrl = configuredRemoteUrl('upstream');
	const haveRef = () => git(['rev-parse', '--verify', '--quiet', UPSTREAM_REF], true) !== '';
	const remoteMatches = (url: string) => url !== '' && sameRepository(url, upstreamUrl);

	if (remoteUrl && !remoteMatches(remoteUrl)) {
		fail(
			`The \`upstream\` remote points at ${terminalUrl(remoteUrl)}, but ${MARKER} names ` +
				`${terminalUrl(upstreamUrl)}.\n` +
				'Refusing to classify against a different repository. Every verdict would be wrong ' +
				'and none would look it. Repoint the remote and fetch it, or correct the marker.\n' +
				"`git remote set-url` on its own leaves the previous remote's tracking ref behind."
		);
	}
	const transportUrl = remoteUrl || upstreamUrl;
	if (remoteUrl) rejectOwnedRepositoryRemote(remoteUrl, root, 'configured upstream');

	// A tracking ref with no remote behind it proves nothing about which
	// repository it came from. An orphan left by a former parent fork makes paths
	// from the real template look fork-only.
	if (!remoteUrl && haveRef() && !allowFetch) {
		fail(
			`${UPSTREAM_REF} exists but no \`upstream\` remote is configured, so nothing ties it to ` +
				`${terminalUrl(upstreamUrl)}.\nRun \`git remote add upstream <url> && git fetch upstream\`, ` +
				'or re-run with --fetch.'
		);
	}

	let fetchedSha: string | null = null;
	if (allowFetch) {
		rejectUrlRewrite(upstreamUrl);
		const symbolicTarget = git(['symbolic-ref', '-q', UPSTREAM_REF], true);
		if (symbolicTarget) {
			fail(
				`${UPSTREAM_REF} is a symbolic ref to ${terminalSafe(symbolicTarget)}. ` +
					'Replace it with an ordinary remote-tracking ref before fetching.'
			);
		}
		const objectFormat = git(['rev-parse', '--show-object-format'], true);
		const zeroOid = '0'.repeat(objectFormat === 'sha256' ? 64 : 40);
		const refBeforeFetch = haveRef() ? git(['rev-parse', UPSTREAM_REF]) : zeroOid;
		let addedRemote = false;
		const transport = transportRemote(transportUrl);
		console.error(`Fetching upstream (${terminalUrl(upstreamUrl)}) ...`);
		const expected = advertisedMainAt(transportUrl);
		try {
			rejectTransportCommandOverrides();
			verifyLocalRemoteSnapshot(transportUrl);
			gitBytes(
				[
					'fetch',
					'--quiet',
					'--no-auto-maintenance',
					'--refmap=',
					'--no-tags',
					'--no-write-fetch-head',
					transport,
					'refs/heads/main'
				],
				false,
				trustedTransportEnv(),
				NETWORK_TIMEOUT_MS
			);
			verifyLocalRemoteSnapshot(transportUrl);
		} catch {
			fail(
				`Could not fetch refs/heads/main from ${terminalUrl(upstreamUrl)}. ` +
					'Refusing to reuse an older tracking ref.'
			);
		}
		if (
			!expected ||
			advertisedMainAt(transportUrl) !== expected ||
			git(['cat-file', '-t', expected], true) !== 'commit'
		) {
			fail('Upstream main changed or its fetched commit is unavailable. Run the report again.');
		}
		if (!remoteUrl) {
			rejectSecretBearingRemoteUrl(upstreamUrl);
			try {
				git(['remote', 'add', 'upstream', upstreamUrl]);
				transportConfigurationAtCopy = readTransportConfiguration();
				addedRemote = true;
			} catch {
				fail(`Could not add the \`upstream\` remote for ${terminalUrl(upstreamUrl)}.`);
			}
			remoteUrl = upstreamUrl;
		}
		if (normalizeRemote(configuredRemoteUrl('upstream')) !== normalizeRemote(remoteUrl)) {
			fail(
				'The shared upstream URL changed while this report fetched objects. ' +
					'No tracking ref was written; run the report again.'
			);
		}
		try {
			git([
				'update-ref',
				'--no-deref',
				'-m',
				'fetch upstream main: upstream relevance',
				UPSTREAM_REF,
				expected,
				refBeforeFetch
			]);
		} catch {
			if (addedRemote && !removeDetectorAddedUpstreamRemote(upstreamUrl)) {
				fail(
					'The shared upstream tracking ref changed while this report fetched objects, and the newly added remote changed before it could be rolled back.'
				);
			}
			fail(
				'The shared upstream tracking ref changed while this report fetched objects. ' +
					(addedRemote
						? 'The newly added remote was rolled back; run it again after the other fetch finishes.'
						: 'Run it again after the other fetch finishes.')
			);
		}
		if (normalizeRemote(configuredRemoteUrl('upstream')) !== normalizeRemote(remoteUrl)) {
			try {
				git([
					'update-ref',
					'--no-deref',
					'-m',
					'roll back upstream relevance fetch after URL change',
					UPSTREAM_REF,
					refBeforeFetch,
					expected
				]);
			} catch {
				fail(
					'The shared upstream URL changed after the tracking ref update, and the ref also moved before it could be rolled back.'
				);
			}
			fail(
				'The shared upstream URL changed after the tracking ref update. The ref was rolled back; run the report again.'
			);
		}
		try {
			// A no-op update-ref writes no reflog entry. Keep the fetched SHA, time,
			// and URL identity together so a later no-fetch run can bind this copy.
			git([
				'config',
				'--local',
				UPSTREAM_FETCH_CONFIG,
				`${expected} ${Math.floor(Date.now() / 1000)} ${remoteFingerprint(upstreamUrl)}`
			]);
		} catch {
			let refRolledBack = false;
			try {
				git([
					'update-ref',
					'--no-deref',
					'-m',
					'roll back upstream relevance fetch after config failure',
					UPSTREAM_REF,
					refBeforeFetch,
					expected
				]);
				refRolledBack = true;
			} catch {
				// The diagnostic below names the state that could not be restored.
			}
			const remoteRolledBack = !addedRemote || removeDetectorAddedUpstreamRemote(upstreamUrl);
			if (!refRolledBack || !remoteRolledBack) {
				fail(
					'The upstream fetch time could not be recorded, and shared Git state changed before the ref or new remote could be rolled back.'
				);
			}
			fail(
				'The upstream fetch time could not be recorded. The tracking ref was rolled back' +
					(addedRemote ? ', along with the newly added remote.' : '.')
			);
		}
		fetchedSha = expected;
	}

	if (!haveRef()) {
		fail(
			`No local copy of upstream (${UPSTREAM_REF} is missing).\n` +
				`Upstream relevance is UNKNOWN for this run. Say so; "nothing to report" is a different answer.\n` +
				'Run `git fetch upstream main:refs/remotes/upstream/main` (add the remote first if needed), ' +
				'or re-run with --fetch.'
		);
	}

	// Pin the tree between two checks of the shared remote. A final check after
	// classification also catches a sync that lands while the pinned tree is read.
	const sha = fetchedSha ?? git(['rev-parse', UPSTREAM_REF]);
	const checkedUrl = configuredRemoteUrl('upstream');
	const checkedSha = git(['rev-parse', UPSTREAM_REF]);
	if (!remoteMatches(checkedUrl) || checkedSha !== sha) {
		fail(
			'The shared `upstream` remote or its main tracking ref changed while this report started. ' +
				'Run it again after the sync or fetch finishes.'
		);
	}
	remoteUrl = checkedUrl;

	if (fetchedSha !== null) {
		return {
			sha,
			ageDays: 0,
			ageFrom: 'fetch',
			remoteUrl,
			identityTrusted: true,
			verifyAdvertisedMain: true,
			absenceTrusted: true
		};
	}

	// Only the newest ref movement can describe the pinned tree. An older fetch
	// cannot lend its timestamp to a ref that another command later restored.
	const entry = latestRefLogEntry(UPSTREAM_REF);
	const reflogFetch = cameFromUpstreamMain(entry, sha) ? entry!.timestamp : NaN;
	const recordedFetch = recordedFetchTimestamp(sha, upstreamUrl);
	const fetched = Math.max(
		Number.isFinite(reflogFetch) ? reflogFetch : 0,
		Number.isFinite(recordedFetch) ? recordedFetch : 0
	);
	const finalUrl = configuredRemoteUrl('upstream');
	const finalSha = git(['rev-parse', UPSTREAM_REF]);
	if (!remoteMatches(finalUrl) || finalSha !== sha) {
		fail(
			'The shared `upstream` remote or its main tracking ref changed while this report started. ' +
				'Run it again after the sync or fetch finishes.'
		);
	}
	const liveAdvertisementMatches = Number.isFinite(recordedFetch)
		? false
		: advertisedMainAt(finalUrl) === sha;
	const committed = Number(git(['log', '-1', '--format=%ct', sha], true));
	const measured = Number.isFinite(fetched) && fetched > 0 ? fetched : committed;
	const ageDays = Number.isFinite(measured)
		? Math.floor((Date.now() / 1000 - measured) / 86400)
		: null;
	const ageFrom = Number.isFinite(fetched) && fetched > 0 ? 'fetch' : 'tip commit';
	return {
		sha,
		ageDays,
		ageFrom,
		remoteUrl: finalUrl,
		identityTrusted: Number.isFinite(recordedFetch) || liveAdvertisementMatches,
		verifyAdvertisedMain: !Number.isFinite(recordedFetch) && liveAdvertisementMatches,
		absenceTrusted: false
	};
}

function verifyUpstreamSnapshot(upstreamUrl: string, snapshot: UpstreamSnapshot): void {
	const url = configuredRemoteUrl('upstream');
	const sha = git(['rev-parse', '--verify', '--quiet', UPSTREAM_REF], true);
	if (
		normalizeRemote(url) !== normalizeRemote(snapshot.remoteUrl) ||
		!sameRepository(url, upstreamUrl) ||
		sha !== snapshot.sha
	) {
		fail(
			'The shared `upstream` remote or its main tracking ref changed during this report. ' +
				'Run it again after the sync or fetch finishes.'
		);
	}
	if (snapshot.verifyAdvertisedMain && advertisedMainAt(snapshot.remoteUrl) !== snapshot.sha) {
		fail('Upstream main changed during this report. Run it again on the settled remote.');
	}
}

function absenceUnmeasuredNote(
	marker: MarkerSnapshot,
	upstream: UpstreamSnapshot
): string | undefined {
	if (!upstream.absenceTrusted) {
		return 'this run did not fetch upstream, so an absent local path cannot prove fork ownership';
	}
	if (marker.provenance.length === 0) {
		return `${MARKER} has no forkPoint or lastSynced commit to bind negative evidence to this fork`;
	}
	if (
		marker.provenance.some((commit) => git(['merge-base', commit, upstream.sha], true) !== commit)
	) {
		return `${MARKER} provenance is not reachable from the fetched upstream tip; rewritten upstream history cannot prove fork ownership`;
	}
	return undefined;
}

interface LocalSnapshot {
	head: string;
	marker: Buffer | null;
	index: Buffer | null;
	shallow: Buffer | null;
	status: Buffer;
	worktree: Map<string, string>;
}

function optionalFile(path: string | undefined): Buffer | null {
	if (!path) return null;
	try {
		lstatSync(path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		fail(
			`Could not inspect snapshot file: ${terminalSafe(err instanceof Error ? err.message : String(err))}`
		);
	}
	try {
		return readFileSync(path);
	} catch (err) {
		fail(
			`Snapshot file exists but could not be read: ${terminalSafe(err instanceof Error ? err.message : String(err))}`
		);
	}
}

function localSnapshot(
	head: string,
	marker: Buffer | null,
	shallow = optionalFile(callerShallowPath)
): LocalSnapshot {
	return {
		head,
		marker,
		index: callerIndexAtCopy,
		shallow,
		worktree: new Map(),
		status: gitBytes(
			['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignore-submodules=none'],
			false,
			{},
			WORKTREE_TIMEOUT_MS
		)
	};
}

function statusPathAfter(record: string, fields: number): string | null {
	let at = -1;
	for (let i = 0; i < fields; i++) {
		at = record.indexOf(' ', at + 1);
		if (at === -1) return null;
	}
	return record.slice(at + 1);
}

interface StatusPath {
	path: string;
	unstaged: boolean;
}

function changedStatusPaths(status: Buffer): StatusPath[] {
	const records = decodeZRecords(status);
	const paths: StatusPath[] = [];
	for (let i = 0; i < records.length; i++) {
		const record = records[i]!;
		let path: string | null = null;
		let unstaged = false;
		if (record.startsWith('1 ')) {
			path = statusPathAfter(record, 8);
			unstaged = record[3] !== '.';
		} else if (record.startsWith('2 ')) {
			path = statusPathAfter(record, 9);
			unstaged = record[3] !== '.';
			i++;
		} else if (record.startsWith('u ')) {
			path = statusPathAfter(record, 10);
			unstaged = true;
		} else if (record.startsWith('? ')) {
			path = record.slice(2);
			unstaged = true;
		} else if (record.startsWith('! ')) continue;
		else fail('Git returned an unrecognized porcelain-v2 status record.');
		if (!path) fail('Git returned a malformed porcelain-v2 status record.');
		paths.push({ path, unstaged });
	}
	return paths;
}

function sameOptionalBuffer(left: Buffer | null, right: Buffer | null): boolean {
	return left === null ? right === null : right !== null && left.equals(right);
}

function verifyLocalSnapshot(root: string, snapshot: LocalSnapshot): void {
	const current = localSnapshot(git(['rev-parse', 'HEAD']), readUpstreamMarker(root).bytes);
	current.index = optionalFile(callerIndexPath);
	current.worktree = fingerprintPaths([...snapshot.worktree.keys()]);
	const worktreeMatches = [...snapshot.worktree].every(
		([path, fingerprint]) => current.worktree.get(path) === fingerprint
	);
	if (
		current.head !== snapshot.head ||
		!sameOptionalBuffer(current.marker, snapshot.marker) ||
		!sameOptionalBuffer(current.index, snapshot.index) ||
		!sameOptionalBuffer(current.shallow, snapshot.shallow) ||
		!current.status.equals(snapshot.status) ||
		!worktreeMatches
	) {
		fail(
			'HEAD, the upstream marker, the index, the shallow boundary, or the working tree changed during this report. Run it again on the settled state.'
		);
	}
}

interface OriginSnapshot {
	url: string;
	sha: string;
}

interface BaseResolution {
	base: string;
	origin: OriginSnapshot | null;
}

function advertisedMainAt(url: string): string {
	rejectTransportCommandOverrides();
	// This name exists only in the private config. It keeps the URL out of process
	// arguments without inheriting remote.<name>.uploadpack from the repository.
	const remote = transportRemote(url);
	const advertised = gitBytes(
		['ls-remote', '--exit-code', '--refs', remote, 'refs/heads/main'],
		true,
		trustedTransportEnv(),
		NETWORK_TIMEOUT_MS
	)
		.toString('utf8')
		.trim()
		.split('\t')[0]!;
	verifyLocalRemoteSnapshot(url);
	return advertised;
}

function trustedOriginSnapshot(expectedSha: string): OriginSnapshot {
	const originMain = 'refs/remotes/origin/main';
	const url = configuredRemoteUrl('origin');
	const sha = git(['rev-parse', '--verify', '--quiet', originMain], true);
	if (!url || sha !== expectedSha) {
		fail(
			'`origin/main` or its URL changed during base validation. ' +
				'Fetch `origin main`, then run the report again.'
		);
	}
	rejectUrlRewrite(url);
	rejectOwnedRepositoryRemote(url, gitPath(['rev-parse', '--show-toplevel']), 'origin');
	if (!remoteMainRefspecIsCanonical('origin')) {
		fail(
			'`origin/main` is not mapped exclusively from `refs/heads/main` by the origin fetch refspec. ' +
				'Pass --base <ref> after verifying which commit this change starts from.'
		);
	}
	if (advertisedMainAt(url) !== sha) {
		fail(
			'`origin/main` does not match `refs/heads/main` at the currently configured origin URL. ' +
				'Fetch `origin main`, or pass --base <ref> after verifying the repository and commit.'
		);
	}
	return { url, sha };
}

function verifyOriginSnapshot(snapshot: OriginSnapshot): void {
	const current = trustedOriginSnapshot(snapshot.sha);
	if (normalizeRemote(current.url) !== normalizeRemote(snapshot.url)) {
		fail('The origin URL changed during this report. Run it again on the settled repository.');
	}
}

/**
 * The commit this change starts from. Never guesses: a base that cannot be
 * resolved makes the run fail, because falling back to HEAD turns a fully
 * committed branch into an empty diff and a cheerful "nothing to report".
 *
 * Always the merge base, including for an explicit --base. The file list comes
 * from `base...head` while every verdict compares against `base` directly, so a
 * base that is not an ancestor of HEAD enumerates against one commit and
 * classifies against another; a sibling branch passed here reported an empty
 * list and exited zero.
 */
function resolveBase(head: string, explicit?: string): BaseResolution {
	const ref = explicit ?? 'origin/main';
	const resolved = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], true);
	if (!resolved) {
		if (explicit) fail(`--base ${terminalSafe(explicit)} does not resolve to a commit.`);
		fail(
			'Could not resolve `origin/main`.\n' +
				'Fetch it, or pass --base <ref> explicitly. Refusing to fall back to HEAD, which ' +
				'would report an empty diff for a branch full of changes.'
		);
	}
	const origin = explicit ? null : trustedOriginSnapshot(resolved);
	const mergeBases = git(['merge-base', '--all', head, resolved], true).split('\n').filter(Boolean);
	if (mergeBases.length === 0) {
		fail(
			`No merge base between HEAD and ${terminalSafe(ref)}.\n` +
				'Refusing to compare unrelated histories, which enumerates nothing and reads as ' +
				'"nothing to report".'
		);
	}
	if (mergeBases.length > 1) {
		fail(
			`HEAD and ${terminalSafe(ref)} have multiple best merge bases. ` +
				'Refusing to choose one arbitrarily and omit changes from the report.'
		);
	}
	return { base: mergeBases[0]!, origin };
}

/**
 * One tree, read once. Resolving a path with `rev-parse <ref>:<path>` costs a
 * process per file, and the two trees are read for every file anyway.
 *
 * `-z` matters as much as it does for the collectors: without it git quotes a
 * path holding a tab, a newline or a backslash, and a quoted spelling misses
 * the exact lookup that decides whether the path exists upstream.
 */
type TreeEntry = { mode: string; type: string; sha: string };
interface HistoricalEntries {
	entries: TreeEntry[];
	complete: boolean;
}

function parseTreeRecord(record: string): { path: string; entry: TreeEntry } | null {
	const tab = record.indexOf('\t');
	if (tab === -1) return null;
	const [mode, type, sha] = record.slice(0, tab).split(' ');
	return mode && type && sha ? { path: record.slice(tab + 1), entry: { mode, type, sha } } : null;
}

function readTree(ref: string): Map<string, TreeEntry> {
	const tree = new Map<string, TreeEntry>();
	for (const record of gitZ(['ls-tree', '-r', '-z', ref], false, HISTORY_COMMAND_TIMEOUT_MS)) {
		const parsed = parseTreeRecord(record);
		if (parsed) tree.set(parsed.path, parsed.entry);
	}
	return tree;
}

function commitParents(commit: string): string[] {
	return historyGit(['rev-list', '--parents', '-n', '1', commit])
		.split(' ')
		.slice(1)
		.filter(Boolean);
}

function treeEntryAt(commit: string, path: string): TreeEntry | null {
	const record = historyGitZ(['ls-tree', '-z', commit, '--', `:(literal)${path}`])[0];
	return record ? (parseTreeRecord(record)?.entry ?? null) : null;
}

function renamedSourceBetween(parent: string, commit: string, path: string): string | null {
	const fields = historyGitZ([
		'diff-tree',
		'--no-commit-id',
		'-r',
		'--find-renames=1%',
		'--find-copies=1%',
		'--find-copies-harder',
		'-l0',
		'--name-status',
		'-z',
		parent,
		commit
	]);
	for (let i = 0; i < fields.length; i++) {
		const status = fields[i] ?? '';
		if (/^[RC]\d+$/.test(status)) {
			const source = fields[i + 1];
			const destination = fields[i + 2];
			if (source && destination === path) return source;
			i += 2;
		} else {
			i += 1;
		}
	}
	return null;
}

function readHistoricalEntries(head: string, path: string): HistoricalEntries {
	// `git log --follow` stops when a merge creates the destination. Treat each
	// merge parent as another follow segment, mapping copies and renames against
	// that parent before continuing.
	const entries: TreeEntry[] = [];
	const segments: Array<{ tip: string; path: string }> = [{ tip: head, path }];
	const visited = new Set<string>();
	let complete = true;
	while (segments.length > 0) {
		const segment = segments.pop()!;
		const segmentKey = `${segment.tip}\0${segment.path}`;
		if (visited.has(segmentKey)) continue;
		visited.add(segmentKey);
		let commits: string[];
		try {
			commits = historyGit([
				'log',
				'--format=%H',
				'--follow',
				'--find-renames=1%',
				'--find-copies=1%',
				'--find-copies-harder',
				'-l0',
				segment.tip,
				'--',
				`:(literal)${segment.path}`
			])
				.split('\n')
				.filter(Boolean);
		} catch {
			complete = false;
			continue;
		}
		try {
			if (commits[0] !== segment.tip && treeEntryAt(segment.tip, segment.path)) {
				commits.unshift(segment.tip);
			}
		} catch {
			complete = false;
			continue;
		}
		let historicalPath = segment.path;
		let oldestCommit: string | null = null;
		let endedAtMerge = false;
		for (const commit of commits) {
			oldestCommit = commit;
			try {
				const entry = treeEntryAt(commit, historicalPath);
				if (
					entry &&
					!entries.some((existing) => existing.mode === entry.mode && existing.sha === entry.sha)
				) {
					entries.push(entry);
				}
				const parents = commitParents(commit);
				if (parents.length > 1) {
					endedAtMerge = true;
					for (const parent of parents) {
						const source = renamedSourceBetween(parent, commit, historicalPath);
						const parentPath =
							source ?? (treeEntryAt(parent, historicalPath) ? historicalPath : null);
						if (parentPath) segments.push({ tip: parent, path: parentPath });
					}
					break;
				}
				if (parents.length === 1) {
					historicalPath =
						renamedSourceBetween(parents[0]!, commit, historicalPath) ?? historicalPath;
				}
			} catch {
				complete = false;
				break;
			}
		}
		if (!endedAtMerge && oldestCommit) {
			try {
				for (const parent of commitParents(oldestCommit)) {
					if (treeEntryAt(parent, historicalPath)) {
						segments.push({ tip: parent, path: historicalPath });
					}
				}
			} catch {
				complete = false;
			}
		}
	}
	return { entries, complete };
}

/** The snapshotted index, including content staged over HEAD. */
function readIndexTree(): Map<string, TreeEntry> {
	const tree = new Map<string, TreeEntry>();
	const unmerged = new Set<string>();
	for (const record of gitZ(['ls-files', '--stage', '-z'])) {
		const tab = record.indexOf('\t');
		if (tab === -1) continue;
		const [mode, sha, stage] = record.slice(0, tab).split(' ');
		const path = record.slice(tab + 1);
		if (stage !== '0') {
			unmerged.add(path);
			continue;
		}
		if (mode && sha) {
			tree.set(path, {
				mode,
				type: mode === '160000' ? 'commit' : 'blob',
				sha
			});
		}
	}
	if (unmerged.size > 0) {
		fail(
			'Upstream relevance cannot classify an index with unresolved merge stages:\n' +
				[...unmerged]
					.sort()
					.map((path) => `  ${terminalSafe(path)}`)
					.join('\n') +
				'\nResolve the conflicts, then run the report again.'
		);
	}
	return tree;
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

function rejectHiddenIndexEntries(paths?: string[]): void {
	const requested = paths ? new Set(paths) : null;
	const hidden: string[] = [];
	for (const record of gitZ(['ls-files', '-v', '-z'])) {
		const marker = record[0] ?? '';
		const path = record.slice(2);
		if ((marker === 'S' || /^[a-z]$/.test(marker)) && (requested === null || requested.has(path))) {
			hidden.push(path);
		}
	}
	if (hidden.length === 0) return;
	fail(
		'Upstream relevance cannot trust index entries marked assume-unchanged or skip-worktree:\n' +
			hidden.map((path) => `  ${terminalSafe(path)}`).join('\n') +
			'\nClear those flags, then run the report again.'
	);
}

/**
 * Every path this change touches, including the ones the obvious command drops.
 *
 * `--name-only` prints a rename's destination and not its source, so moving a
 * pristine template file to a fork-only path would be classified on the
 * destination alone and disappear. `--name-status -M` keeps both. Untracked
 * files are absent from every diff, so they are collected separately; a brand
 * new file at a path upstream also has is exactly the case worth seeing.
 */
function changedPaths(base: string, head: string): string[] {
	rejectHiddenIndexEntries();
	const paths = new Set<string>();
	const add = (path: string): void => {
		paths.add(path);
		if (paths.size > PATH_LIMIT) {
			fail(`Automatic discovery found more than ${PATH_LIMIT} changed paths. Narrow the request.`);
		}
	};

	// Every collector reads the same HEAD. The index is snapshotted once, so a
	// commit landing mid-run would otherwise let the committed collector see the
	// old HEAD while the later two compare the new one against a copy that
	// already holds the change: the path drops out of all three lists and the
	// run exits zero on a state the repository was never in.
	//
	// Deliberately NOT allowFail. An empty result from a failed git call is
	// indistinguishable from an empty result from a clean tree, and the second
	// one exits zero saying there is nothing to report. A broken diff.renames
	// value in inherited config was enough to produce exactly that.
	const collect = (fn: () => void, what: string): void => {
		try {
			fn();
		} catch (err) {
			fail(
				`Could not enumerate ${what}: ${terminalSafe(err instanceof Error ? err.message : String(err))}\n` +
					'Refusing to continue. An incomplete file list reports as "nothing to send upstream".'
			);
		}
	};
	const collectStatus = (args: string[], what: string): void => {
		collect(() => {
			let pathsRemaining = 0;
			gitZEach(
				args,
				(record) => {
					if (pathsRemaining > 0) {
						add(record);
						pathsRemaining--;
						return;
					}
					// Rename and copy statuses carry two paths; every other
					// changed status carries one.
					if (/^[RC]\d*$/.test(record)) pathsRemaining = 2;
					else if (/^[A-Z]\d*$/.test(record)) pathsRemaining = 1;
				},
				DIFF_COMMAND_TIMEOUT_MS
			);
			if (pathsRemaining !== 0) throw new Error('Git returned an incomplete name-status record.');
		}, what);
	};

	collectStatus(
		['diff', '--ignore-submodules=none', '--name-status', '-M', '-z', `${base}...${head}`],
		'committed changes'
	);
	collectStatus(
		['diff', '--ignore-submodules=none', '--name-status', '-M', '-z', head],
		'unstaged changes'
	);
	collectStatus(
		['diff', '--ignore-submodules=none', '--name-status', '-M', '-z', '--cached', head],
		'staged changes'
	);
	collect(
		() => gitZEach(['ls-files', '--others', '--exclude-standard', '-z'], add),
		'untracked files'
	);
	return [...paths].sort();
}

type CachedBag =
	| { kind: 'text'; bag: Bag }
	| { kind: 'binary' }
	| { kind: 'invalid-text' }
	| { kind: 'missing' }
	| { kind: 'oversized' }
	| { kind: 'representation' };

interface UpstreamBlobCandidate {
	path: string;
	sha: string;
}

interface Upstream {
	/** Resolved once, so a fetch landing mid-run cannot mix two trees. */
	sha: string;
	tree: Map<string, TreeEntry>;
	byFold: Map<string, string>;
	/** Objects reachable from upstream history; local blob SHAs cannot collide across object types. */
	blobs: Set<string>;
	historyComplete: boolean;
	/** Only names the current template carries exactly once; see uniqueName. */
	uniqueName: Map<string, string>;
	/** Historical blob versions keyed by SHA and the path that named them. */
	candidates: Map<string, UpstreamBlobCandidate>;
	/** Lower-cased extension groups are searched first. */
	byExt: Map<string, string[]>;
	/** Every candidate key, used when a port changed language or extension. */
	blobKeys: string[];
	/** Text tallies and unreadable states, filled in batches on first use. */
	bags: Map<string, CachedBag>;
	bagsBySha: Map<string, CachedBag>;
	bagSourceBytes: number;
	bagRepresentationUnits: number;
	similarityOperationsRemaining: number;
}

function readUpstream(sha: string): Upstream {
	const tree = readTree(sha);
	const byFold = new Map<string, string>();
	// `rev-list --objects -z` arrived in Git 2.50. Raw log records have used NUL
	// path framing for much longer, and --no-renames gives every record one path.
	// Root and merge-parent diffs expose both historical sides of every blob.
	const history = gitPartialBytes(
		[
			'log',
			'--format=',
			'--raw',
			'-z',
			'--no-abbrev',
			'--full-index',
			'-m',
			'--root',
			'--no-renames',
			sha
		],
		undefined,
		HISTORY_COMMAND_TIMEOUT_MS
	);
	const records: Array<{ sha: string; path: string }> = [];
	let historyParsed = history.complete;
	let historyRecordsExceeded = false;
	let pendingHeader: string | undefined;
	if (history.complete) {
		visitZRecords(history.output, (record) => {
			if (!historyParsed || historyRecordsExceeded) return;
			if (pendingHeader === undefined) {
				pendingHeader = record;
				return;
			}
			const match = pendingHeader.match(/^:\d{6} \d{6} ([0-9a-f]+) ([0-9a-f]+) [AMDTUXB]$/);
			pendingHeader = undefined;
			if (!match) {
				historyParsed = false;
				return;
			}
			for (const objectSha of [match[1], match[2]]) {
				if (!objectSha || /^0+$/.test(objectSha)) continue;
				if (records.length >= HISTORY_RECORD_LIMIT) {
					historyRecordsExceeded = true;
					return;
				}
				records.push({ sha: objectSha, path: record });
			}
		});
		if (pendingHeader !== undefined) historyParsed = false;
	}
	const objectShas = [...new Set(records.map((record) => record.sha))];
	const objectInfo = gitPartialBytes(
		['cat-file', '--batch-check=%(objectname) %(objecttype)'],
		objectShas.join('\n') + (objectShas.length > 0 ? '\n' : ''),
		HISTORY_COMMAND_TIMEOUT_MS
	);
	const objectTypes = new Map<string, string>();
	for (const line of objectInfo.output.toString('utf8').trim().split('\n')) {
		const [objectSha, type] = line.split(' ');
		if (objectSha && type && type !== 'missing') objectTypes.set(objectSha, type);
	}
	const blobs = new Set(
		[...objectTypes].filter(([, type]) => type === 'blob').map(([objectSha]) => objectSha)
	);
	const seen = new Map<string, string | null>();
	for (const [path] of tree) {
		if (!byFold.has(path.toLowerCase())) byFold.set(path.toLowerCase(), path);
		const name = basename(path).toLowerCase();
		seen.set(name, seen.has(name) ? null : path);
	}
	// A name the template uses more than once says nothing: `types.ts` and
	// `index.ts` sit in a dozen places and would flag every fork file that
	// happens to share one. Measured against this fork's 1293 fork-only paths,
	// keeping only the names upstream carries once flags 21 of them, most of
	// them real relocations (src/lib/convex/usage/* was aiUsage/* upstream,
	// src/lib/auth/clock-skew* was hooks/clock-skew*). The looser form flags 61.
	const uniqueName = new Map<string, string>();
	for (const [name, path] of seen) if (path !== null) uniqueName.set(name, path);
	const candidates = new Map<string, UpstreamBlobCandidate>();
	for (const record of records) {
		if (objectTypes.get(record.sha) !== 'blob') continue;
		candidates.set(`${record.sha}\0${record.path}`, { path: record.path, sha: record.sha });
	}
	for (const [path, entry] of tree) {
		if (entry.type === 'blob') {
			candidates.set(`${entry.sha}\0${path}`, { path, sha: entry.sha });
		}
	}
	const byExt = new Map<string, string[]>();
	const blobKeys = [...candidates.keys()];
	for (const [key, candidate] of candidates) {
		const e = extension(candidate.path);
		const group = byExt.get(e);
		if (group) group.push(key);
		else byExt.set(e, [key]);
	}
	return {
		sha,
		tree,
		byFold,
		blobs,
		historyComplete:
			history.complete &&
			historyParsed &&
			!historyRecordsExceeded &&
			objectInfo.complete &&
			objectTypes.size === objectShas.length,
		uniqueName,
		candidates,
		byExt,
		blobKeys,
		bags: new Map(),
		bagsBySha: new Map(),
		bagSourceBytes: 0,
		bagRepresentationUnits: 0,
		similarityOperationsRemaining: SIMILARITY_OPERATION_LIMIT
	};
}

function extension(path: string): string {
	const name = basename(path);
	const dot = name.lastIndexOf('.');
	return (dot <= 0 ? '' : name.slice(dot)).toLowerCase();
}

/**
 * Blob contents by SHA, in bounded batches.
 *
 * A missing or oversized blob stays absent. Callers turn that unknown into
 * `unmeasured`; one large history cannot overflow the process output buffer.
 */
function readBlobs(shas: string[], maxSourceBytes = Number.POSITIVE_INFINITY): Map<string, Buffer> {
	const out = new Map<string, Buffer>();
	const unique = [...new Set(shas)];
	if (unique.length === 0) return out;
	const sizeResult = gitPartialBytes(
		['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
		unique.join('\n') + '\n',
		HISTORY_COMMAND_TIMEOUT_MS
	);
	if (!sizeResult.complete) return out;
	const sizes = new Map<string, number>();
	for (const line of sizeResult.output.toString('utf8').trim().split('\n')) {
		const [sha, type, rawSize] = line.split(' ');
		const size = Number(rawSize);
		if (sha && type === 'blob' && Number.isFinite(size)) sizes.set(sha, size);
	}

	const readBatch = (batch: string[]) => {
		if (batch.length === 0) return;
		let res: Buffer;
		try {
			res = execFileSync('git', [...PINNED_CONFIG, 'cat-file', '--batch'], {
				input: batch.join('\n') + '\n',
				maxBuffer: BLOB_OUTPUT_LIMIT,
				env: gitRunEnv(),
				stdio: ['pipe', 'pipe', 'pipe'],
				timeout: HISTORY_COMMAND_TIMEOUT_MS
			});
		} catch {
			return;
		}
		let at = 0;
		while (at < res.length) {
			const newline = res.indexOf(0x0a, at);
			if (newline < 0) break;
			const header = res.slice(at, newline).toString('utf8').split(' ');
			if (header.length < 3) {
				at = newline + 1;
				continue;
			}
			const size = Number(header[2]);
			if (!Number.isFinite(size)) break;
			out.set(header[0]!, res.subarray(newline + 1, newline + 1 + size));
			at = newline + 1 + size + 1;
		}
	};

	let batch: string[] = [];
	let bytes = 0;
	let sourceBytes = 0;
	for (const sha of unique) {
		const size = sizes.get(sha);
		if (size === undefined || sourceBytes + size > maxSourceBytes) continue;
		const estimated = size + 128;
		if (estimated > BLOB_BATCH_BYTES) continue;
		if (batch.length >= BLOB_BATCH_ITEMS || bytes + estimated > BLOB_BATCH_BYTES) {
			readBatch(batch);
			batch = [];
			bytes = 0;
		}
		batch.push(sha);
		bytes += estimated;
		sourceBytes += size;
	}
	readBatch(batch);
	return out;
}

/** A line tally with its total kept alongside, so a bound can skip reading it. */
interface Bag {
	lines: Map<string, number>;
	total: number;
	grams?: Uint32Array;
}

const GRAM_WIDTH = 8;

function characterGrams(line: string): Uint32Array {
	if (line.length < GRAM_WIDTH) return new Uint32Array();
	const grams = new Uint32Array(line.length - GRAM_WIDTH + 1);
	for (let i = 0; i < grams.length; i++) {
		let hash = 0x811c9dc5;
		for (let j = 0; j < GRAM_WIDTH; j++) {
			hash ^= line.charCodeAt(i + j);
			hash = Math.imul(hash, 0x01000193);
		}
		grams[i] = hash >>> 0;
	}
	return grams.sort();
}

function gramSimilarity(mine: Uint32Array, theirs: Uint32Array): number {
	const denominator = Math.min(mine.length, theirs.length);
	if (denominator === 0) return 0;
	let left = 0;
	let right = 0;
	let shared = 0;
	while (left < mine.length && right < theirs.length) {
		if (mine[left] === theirs[right]) {
			shared++;
			left++;
			right++;
		} else if (mine[left]! < theirs[right]!) left++;
		else right++;
	}
	return shared / denominator;
}

/**
 * How much of one blob the other still carries. Multiline text uses shared
 * lines over the larger file; overlapping character spans catch systematic
 * edits that change every line and small changes to minified one-line text.
 */
function blobSimilarity(mine: Bag, theirs: Bag): number {
	const denominator = Math.max(mine.total, theirs.total);
	if (denominator === 0) return 0;
	let shared = 0;
	for (const [line, count] of mine.lines) shared += Math.min(count, theirs.lines.get(line) ?? 0);
	const lineScore = shared / denominator;
	return mine.grams && theirs.grams
		? Math.max(lineScore, gramSimilarity(mine.grams, theirs.grams))
		: lineScore;
}

/**
 * Git's default rename similarity. Measured against this fork's 1267 remaining
 * fork-only paths: 14 are flagged at 50%, 24 at 40% and 10 at 60%. Sixty loses
 * the case this rung exists for (an email template copied from the template's
 * own and then rewritten scores 59), and forty starts flagging shadcn barrel
 * files that merely share a shape.
 */
const SIMILAR_ENOUGH = 0.5;

interface SimilarityResult {
	path: string | null;
	measured: boolean;
	note?: string;
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const UTF16_LE = new TextDecoder('utf-16le', { fatal: true });
const UTF16_BE = new TextDecoder('utf-16be', { fatal: true });
const hasUtf16Bom = (bytes: Buffer) =>
	(bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);

function utf16TextOf(bytes: Buffer): { detected: boolean; text?: string } {
	let decoder: TextDecoder | undefined;
	let content = bytes;
	if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		decoder = UTF16_LE;
		content = bytes.subarray(2);
	} else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		decoder = UTF16_BE;
		content = bytes.subarray(2);
	} else {
		const pairs = Math.floor(bytes.length / 2);
		if (pairs === 0) return { detected: false };
		let evenNuls = 0;
		let oddNuls = 0;
		for (let index = 0; index < pairs * 2; index += 2) {
			if (bytes[index] === 0) evenNuls++;
			if (bytes[index + 1] === 0) oddNuls++;
		}
		if (oddNuls / pairs >= 0.3 && evenNuls / pairs <= 0.1) decoder = UTF16_LE;
		else if (evenNuls / pairs >= 0.3 && oddNuls / pairs <= 0.1) decoder = UTF16_BE;
		else return { detected: false };
	}
	try {
		const text = decoder.decode(content);
		return text.includes('\0') ? { detected: true } : { detected: true, text };
	} catch {
		return { detected: true };
	}
}

function textOf(bytes: Buffer): string | null {
	if (hasUtf16Bom(bytes) || bytes.includes(0)) return utf16TextOf(bytes).text ?? null;
	try {
		return UTF8.decode(bytes);
	} catch {
		return null;
	}
}

function takeSimilarityOperations(upstream: Upstream, count: number): boolean {
	if (count > upstream.similarityOperationsRemaining) {
		upstream.similarityOperationsRemaining = 0;
		return false;
	}
	upstream.similarityOperationsRemaining -= count;
	return true;
}

function cacheBags(keys: string[], upstream: Upstream): boolean {
	const unread: string[] = [];
	for (const key of keys) {
		if (!takeSimilarityOperations(upstream, 1)) return false;
		if (!upstream.bags.has(key)) unread.push(key);
	}
	if (unread.length === 0) return true;
	const blobs = readBlobs(
		[...new Set(unread.map((key) => upstream.candidates.get(key)!.sha))],
		Math.max(0, BLOB_BATCH_BYTES - upstream.bagSourceBytes)
	);
	for (const key of unread) {
		const sha = upstream.candidates.get(key)!.sha;
		let cached = upstream.bagsBySha.get(sha);
		if (!cached) {
			const blob = blobs.get(sha);
			if (blob === undefined || upstream.bagSourceBytes + blob.length > BLOB_BATCH_BYTES) {
				cached = { kind: 'missing' };
			} else if (blob.length > SIMILARITY_SOURCE_LIMIT) {
				cached = { kind: 'oversized' };
			} else {
				upstream.bagSourceBytes += blob.length;
				const utf16 = hasUtf16Bom(blob) || blob.includes(0) ? utf16TextOf(blob) : undefined;
				if (utf16 && !utf16.detected) cached = { kind: 'binary' };
				else {
					try {
						const text = utf16 ? utf16.text : UTF8.decode(blob);
						if (text === undefined) cached = { kind: 'invalid-text' };
						else {
							const cost = bagRepresentationCost(text);
							if (
								cost > SIMILARITY_REPRESENTATION_LIMIT ||
								upstream.bagRepresentationUnits + cost > SIMILARITY_REPRESENTATION_LIMIT
							) {
								cached = { kind: 'representation' };
							} else {
								upstream.bagRepresentationUnits += cost;
								cached = { kind: 'text', bag: bagOf(text) };
							}
						}
					} catch {
						cached = { kind: 'invalid-text' };
					}
				}
			}
			upstream.bagsBySha.set(sha, cached);
		}
		upstream.bags.set(key, cached);
	}
	return true;
}

const POTENTIAL_TEXT_EXTENSIONS = new Set([
	'',
	'.c',
	'.cc',
	'.cpp',
	'.conf',
	'.cs',
	'.css',
	'.csv',
	'.cts',
	'.go',
	'.gql',
	'.graphql',
	'.h',
	'.hpp',
	'.html',
	'.ini',
	'.java',
	'.js',
	'.json',
	'.jsonc',
	'.jsx',
	'.less',
	'.lua',
	'.m',
	'.md',
	'.mdx',
	'.mjs',
	'.mts',
	'.php',
	'.properties',
	'.proto',
	'.ps1',
	'.py',
	'.rb',
	'.rs',
	'.sass',
	'.scss',
	'.sh',
	'.sql',
	'.svg',
	'.svelte',
	'.swift',
	'.toml',
	'.ts',
	'.tsx',
	'.txt',
	'.vue',
	'.xml',
	'.yaml',
	'.yml'
]);

function searchSimilar(
	mine: Bag,
	candidates: string[],
	upstream: Upstream,
	unreadableIsUnknown = false
): SimilarityResult {
	if (!cacheBags(candidates, upstream)) {
		return {
			path: null,
			measured: false,
			note: 'similarity comparison exceeded the bounded operation count'
		};
	}
	let best = SIMILAR_ENOUGH;
	let bestPath: string | null = null;
	let missing = false;
	let oversized = false;
	let representation = false;
	let unreadable = false;
	let operationsExhausted = false;
	for (const key of candidates) {
		if (!takeSimilarityOperations(upstream, 1)) {
			operationsExhausted = true;
			break;
		}
		const cached = upstream.bags.get(key)!;
		if (cached.kind === 'missing') {
			missing = true;
			continue;
		}
		if (cached.kind === 'oversized') {
			oversized = true;
			continue;
		}
		if (cached.kind === 'representation') {
			representation = true;
			continue;
		}
		if (cached.kind === 'binary') {
			const candidate = upstream.candidates.get(key)!;
			unreadable ||=
				unreadableIsUnknown || POTENTIAL_TEXT_EXTENSIONS.has(extension(candidate.path));
			continue;
		}
		if (cached.kind === 'invalid-text') {
			unreadable = true;
			continue;
		}
		const operations =
			mine.lines.size +
			(mine.grams && cached.bag.grams ? mine.grams.length + cached.bag.grams.length : 0);
		if (!takeSimilarityOperations(upstream, operations)) {
			operationsExhausted = true;
			break;
		}
		const score = blobSimilarity(mine, cached.bag);
		if (score >= best) {
			best = score;
			bestPath = upstream.candidates.get(key)!.path;
		}
	}
	return bestPath === null
		? {
				path: null,
				measured: !operationsExhausted && !missing && !oversized && !representation && !unreadable,
				note: operationsExhausted
					? 'similarity comparison exceeded the bounded operation count'
					: missing
						? 'one or more upstream blobs are absent from this partial clone'
						: oversized
							? 'an upstream blob exceeds the bounded similarity size'
							: representation
								? 'upstream text exceeds the bounded similarity representation'
								: unreadable
									? 'an upstream blob has no safe UTF-8 text comparison'
									: undefined
			}
		: { path: bestPath, measured: true };
}

type SourceBag = { kind: 'bag'; bag: Bag } | { kind: 'unmeasured'; note: string };
const sourceBags = new WeakMap<Buffer, SourceBag>();

function sourceBag(content: Buffer, upstream: Upstream): SourceBag {
	const cached = sourceBags.get(content);
	if (cached) return cached;
	let result: SourceBag;
	if (content.length > SIMILARITY_SOURCE_LIMIT) {
		result = { kind: 'unmeasured', note: 'content exceeds the bounded similarity size' };
	} else if (content.length > upstream.similarityOperationsRemaining) {
		result = {
			kind: 'unmeasured',
			note: 'similarity comparison exceeded the bounded operation count'
		};
	} else {
		upstream.similarityOperationsRemaining -= content.length;
		const text = textOf(content);
		if (text === null) {
			result = {
				kind: 'unmeasured',
				note: 'binary content has no safe line-level resemblance score'
			};
		} else {
			const representation = bagRepresentationCost(text);
			if (representation > SIMILARITY_REPRESENTATION_LIMIT) {
				result = {
					kind: 'unmeasured',
					note: 'content exceeds the bounded similarity representation'
				};
			} else if (representation > upstream.similarityOperationsRemaining) {
				result = {
					kind: 'unmeasured',
					note: 'similarity comparison exceeded the bounded operation count'
				};
			} else {
				upstream.similarityOperationsRemaining -= representation;
				const bag = bagOf(text);
				result =
					bag.total === 0 || (bag.total === 1 && (bag.grams?.length ?? 0) === 0)
						? {
								kind: 'unmeasured',
								note: 'text is too compact to retain a safe line or character-span comparison'
							}
						: { kind: 'bag', bag };
			}
		}
	}
	sourceBags.set(content, result);
	return result;
}

/**
 * The upstream file this content most resembles.
 *
 * Same-extension files go first because they usually find the answer without
 * loading the rest of the tree. A miss widens to every blob. Ports between JS
 * and TS are ordinary, and an extension gate turns them into silent negatives.
 */
function similarTo(content: Buffer, path: string, upstream: Upstream): SimilarityResult {
	const source = sourceBag(content, upstream);
	if (source.kind === 'unmeasured') {
		return { path: null, measured: false, note: source.note };
	}
	const sameExtension = upstream.byExt.get(extension(path)) ?? [];
	const first = searchSimilar(source.bag, sameExtension, upstream, true);
	if (first.path !== null) return first;

	const same = new Set(sameExtension);
	const rest: string[] = [];
	for (const candidate of upstream.blobKeys) {
		if (!takeSimilarityOperations(upstream, 1)) {
			return {
				path: null,
				measured: false,
				note: 'similarity comparison exceeded the bounded operation count'
			};
		}
		if (!same.has(candidate)) rest.push(candidate);
	}
	const widened = searchSimilar(source.bag, rest, upstream);
	if (widened.path !== null) return widened;
	return {
		path: null,
		measured: first.measured && widened.measured,
		note: first.note ?? widened.note
	};
}

interface ContentSet {
	values: Buffer[];
	incompleteNote?: string;
	missing?: boolean;
	fingerprintHint?: string;
}

function symlinkParent(path: string): string | null {
	const parts = path.split('/');
	let parent = '';
	for (const part of parts.slice(0, -1)) {
		parent = parent ? join(parent, part) : part;
		if (lstatSync(parent).isSymbolicLink()) return parent;
	}
	return null;
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

function pathIdentity(path: string): PathIdentity {
	const stats = statSync(path);
	return { path, dev: stats.dev, ino: stats.ino };
}

function samePathIdentity(left: PathIdentity, right: PathIdentity): boolean {
	return left.path === right.path && left.dev === right.dev && left.ino === right.ino;
}

function identityChains(paths: Iterable<string>): PathIdentity[] {
	const identities = new Map<string, PathIdentity>();
	for (const path of paths) {
		let current = path;
		while (true) {
			if (!identities.has(current)) identities.set(current, pathIdentity(current));
			const parent = resolve(current, '..');
			if (parent === current) break;
			current = parent;
		}
	}
	return [...identities.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function sameIdentityChains(left: PathIdentity[], right: PathIdentity[]): boolean {
	return (
		left.length === right.length &&
		left.every((identity, index) => samePathIdentity(identity, right[index]!))
	);
}

function pathResolvesInsideOwnedRoot(candidate: string, ownedRoots: Iterable<string>): boolean {
	const roots = [...ownedRoots];
	const rootStats = roots.map((root) => statSync(root));
	let current = candidate;
	while (true) {
		const fromRoot = roots.some((root) => {
			const relativePath = relative(root, current);
			return (
				relativePath === '' ||
				(!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
			);
		});
		if (fromRoot) return true;
		const currentStats = statSync(current);
		if (rootStats.some((rootStatsEntry) => sameFileIdentity(rootStatsEntry, currentStats))) {
			return true;
		}
		const parent = resolve(current, '..');
		if (parent === current) return false;
		current = parent;
	}
}

function statFingerprint(stats: Stats): string {
	return [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeMs, stats.ctimeMs].join(':');
}

function workingTreeContent(path: string, maxBytes = CAPTURE_LIMIT): ContentSet {
	try {
		const unsafeParent = symlinkParent(path);
		if (unsafeParent) {
			return {
				values: [],
				incompleteNote: `working-tree parent "${unsafeParent}" is a symlink`
			};
		}
		const initial = lstatSync(path);
		if (initial.isSymbolicLink()) {
			const target = readlinkSync(path, { encoding: 'buffer' });
			if (target.length > maxBytes) {
				return {
					values: [],
					incompleteNote: 'working-tree content exceeds the bounded capture size',
					fingerprintHint: statFingerprint(initial)
				};
			}
			const changedParent = symlinkParent(path);
			const after = lstatSync(path);
			if (changedParent || !after.isSymbolicLink() || !sameFileIdentity(initial, after)) {
				return { values: [], incompleteNote: 'working-tree path changed during capture' };
			}
			return { values: [target] };
		}
		if (!initial.isFile()) {
			return { values: [], incompleteNote: 'working-tree path is not a regular file' };
		}

		let fd: number | null = null;
		try {
			fd = openSync(
				path,
				fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
			);
			const opened = fstatSync(fd);
			const changedParent = symlinkParent(path);
			const afterOpen = lstatSync(path);
			if (
				changedParent ||
				!opened.isFile() ||
				!afterOpen.isFile() ||
				!sameFileIdentity(initial, opened) ||
				!sameFileIdentity(opened, afterOpen)
			) {
				return { values: [], incompleteNote: 'working-tree path changed during capture' };
			}
			if (opened.size > maxBytes) {
				return {
					values: [],
					incompleteNote: 'working-tree content exceeds the bounded capture size',
					fingerprintHint: statFingerprint(opened)
				};
			}

			const bytes = Buffer.allocUnsafe(opened.size);
			let total = 0;
			while (total < bytes.length) {
				const read = readSync(fd, bytes, total, bytes.length - total, total);
				if (read === 0) break;
				total += read;
			}
			const afterRead = fstatSync(fd);
			if (
				total !== opened.size ||
				afterRead.size !== opened.size ||
				afterRead.mtimeMs !== opened.mtimeMs ||
				afterRead.ctimeMs !== opened.ctimeMs
			) {
				return { values: [], incompleteNote: 'working-tree content changed during capture' };
			}
			return { values: [bytes] };
		} finally {
			if (fd !== null) closeSync(fd);
		}
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { values: [], missing: true };
		return {
			values: [],
			incompleteNote: `working-tree content could not be read: ${err instanceof Error ? err.message : String(err)}`
		};
	}
}

function fingerprintContent(content: ContentSet): string {
	const hash = createHash('sha256');
	hash.update(content.missing ? 'missing\0' : 'present\0');
	hash.update(content.incompleteNote ?? '');
	hash.update('\0');
	hash.update(content.fingerprintHint ?? '');
	for (const value of content.values) {
		hash.update(String(value.length));
		hash.update('\0');
		hash.update(value);
	}
	return hash.digest('hex');
}

function capturePaths(paths: string[]): {
	fingerprints: Map<string, string>;
	contents: Map<string, ContentSet>;
} {
	const fingerprints = new Map<string, string>();
	const contents = new Map<string, ContentSet>();
	let remaining = CAPTURE_LIMIT;
	for (const path of paths) {
		const content = workingTreeContent(path, remaining);
		contents.set(path, content);
		fingerprints.set(path, fingerprintContent(content));
		remaining -= content.values.reduce((total, value) => total + value.length, 0);
	}
	return { fingerprints, contents };
}

function fingerprintPaths(paths: string[]): Map<string, string> {
	return capturePaths(paths).fingerprints;
}

function capturedDiff(
	before: Buffer,
	after: Buffer
): { output: Buffer | null; incompleteNote?: string } {
	if (diffOperationsRemaining <= 0) {
		return {
			output: null,
			incompleteNote: 'shared-path comparison exceeded the bounded diff command count'
		};
	}
	diffOperationsRemaining--;
	if (!scratchDir) fail('The scratch directory disappeared before captured content was compared.');
	const id = randomUUID();
	const beforePath = join(scratchDir, `${id}-before`);
	const afterPath = join(scratchDir, `${id}-after`);
	writeFileSync(beforePath, before);
	writeFileSync(afterPath, after);
	try {
		return {
			output: execFileSync(
				'git',
				[
					...PINNED_CONFIG,
					'diff',
					'--no-index',
					'--unified=3',
					'--no-ext-diff',
					'--no-textconv',
					'--',
					beforePath,
					afterPath
				],
				{
					env: gitRunEnv(),
					maxBuffer: MAX_GIT_OUTPUT,
					stdio: ['pipe', 'pipe', 'pipe'],
					timeout: DIFF_COMMAND_TIMEOUT_MS
				}
			)
		};
	} catch (err) {
		const failed = err as { status?: unknown; stdout?: unknown };
		// `git diff --no-index` uses status 1 for an ordinary difference. Any
		// other failure may expose only a prefix of stdout, which is not a diff.
		if (failed.status === 1 && Buffer.isBuffer(failed.stdout)) return { output: failed.stdout };
		return {
			output: null,
			incompleteNote: 'one shared-path diff command failed before completing'
		};
	} finally {
		rmSync(beforePath, { force: true });
		rmSync(afterPath, { force: true });
	}
}

/** Every observable version of a path, before and after each change layer. */
function contentsOf(
	working: ContentSet,
	entries: Array<TreeEntry | undefined>,
	localBlobs: Map<string, Buffer>
): ContentSet {
	const values = [...working.values];
	let incompleteNote = working.incompleteNote;
	if (working.missing && !entries.some(Boolean)) {
		incompleteNote = 'working-tree path disappeared after it was enumerated';
	}
	for (const entry of entries) {
		if (!entry) continue;
		if (entry.type !== 'blob') {
			incompleteNote ??= 'one repository state is a gitlink rather than a blob';
			continue;
		}
		const blob = localBlobs.get(entry.sha);
		if (blob === undefined) {
			incompleteNote ??=
				'one repository-state blob is unavailable or outside the bounded local-history capture';
			continue;
		}
		if (!values.some((value) => value.equals(blob))) values.push(blob);
	}
	return { values, incompleteNote };
}

function verdictFor(
	path: string,
	upstream: Upstream,
	baseTree: Map<string, TreeEntry>,
	headTree: Map<string, TreeEntry>,
	indexTree: Map<string, TreeEntry>,
	localBlobs: Map<string, Buffer>,
	upstreamBlobs: Map<string, Buffer>,
	historyEntries: TreeEntry[],
	rootPaths: Set<string>,
	provenancePaths: Set<string>,
	provenancePathsByFold: Set<string>,
	rootOwnershipNote: string | undefined,
	working: ContentSet,
	unstaged: boolean,
	historyIncompleteNote: string | undefined,
	absenceNote: string | undefined,
	identityNote: string | undefined
): FileVerdict {
	const upstreamEntry = upstream.tree.get(path);
	const baseEntry = baseTree.get(path);

	if (identityNote) {
		return classifyVerdict({
			path,
			existsUpstream: true,
			baseMatchesUpstream: false,
			overlap: null,
			unmeasuredNote: identityNote
		});
	}

	if (upstreamEntry === undefined) {
		// macOS and Windows compare filenames case-insensitively while git does
		// not, so a fork file differing from a template file only in case is one
		// file to the filesystem and two to the exact lookup. Calling that
		// Hiding it would be a silent negative on what may be the same file; say it is
		// ambiguous instead.
		const folded = upstream.byFold.get(path.toLowerCase());
		if (folded !== undefined) {
			return classifyVerdict({
				path,
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap: null,
				unmeasuredNote: `differs from upstream's "${folded}" only by case`
			});
		}
		if (provenancePaths.has(path) || provenancePathsByFold.has(path.toLowerCase())) {
			return classifyVerdict({
				path,
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap: null,
				unmeasuredNote: `path existed in ${MARKER} provenance before upstream removed it`
			});
		}
		// An absent path is not proof of fork ownership. Upstream renames a file
		// this fork still carries under the old name, or the fork copies an
		// inherited file to a product-specific path and fixes an inherited bug in
		// the copy. Check every repository state so a staged edit or a later
		// worktree rewrite cannot erase the copied blob from the evidence.
		const entries = [baseEntry, ...historyEntries, headTree.get(path), indexTree.get(path)];
		if (entries.some((entry) => entry && upstream.blobs.has(entry.sha))) {
			return classifyVerdict({
				path,
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap: null,
				unmeasuredNote:
					'no upstream path, but this content is upstream elsewhere (renamed or copied)'
			});
		}
		// Blob identity only recognises a copy this fork never edited. Once the
		// fork has customised its copy, nothing in either tree relates the two,
		// and a file upstream renamed away is the one most likely to still carry
		// a template bug. A name the template uses exactly once is the cheap half
		// of that: it costs a glance and finds a real relocation.
		const sameName = upstream.uniqueName.get(basename(path).toLowerCase());
		if (sameName !== undefined) {
			return classifyVerdict({
				path,
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap: null,
				unmeasuredNote: `no upstream path, but upstream has one file named this: "${sameName}"`
			});
		}
		// Blob identity recognises a copy nobody edited, and the name rung a
		// relocation that kept its name. Neither sees the ordinary case: a
		// template file copied to a product-specific path and customised in the
		// same commit. Measured on this fork, src/lib/emails/templates/
		// SessionHandoffEmail.svelte is a 59% copy of the template's own
		// NewTicketAdminNotificationEmail.svelte, shares no blob and no name, and
		// was silently hidden. An accessibility fix made in it would never have
		// been offered upstream, which is precisely the loss this tool exists to
		// prevent.
		const contents = contentsOf(working, entries, localBlobs);
		let incompleteNote = contents.incompleteNote;
		for (const content of contents.values) {
			const similar = similarTo(content, path, upstream);
			if (similar.path !== null) {
				return classifyVerdict({
					path,
					existsUpstream: true,
					baseMatchesUpstream: false,
					overlap: null,
					unmeasuredNote: `no upstream path, but this mostly matches upstream's "${similar.path}"`
				});
			}
			if (!similar.measured) incompleteNote ??= similar.note;
		}
		if (incompleteNote) {
			return classifyVerdict({
				path,
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap: null,
				unmeasuredNote: incompleteNote
			});
		}
		if (!baseEntry) {
			return classifyVerdict({
				path,
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap: null,
				unmeasuredNote:
					'new file with no measurable upstream counterpart; relevance needs a design judgment'
			});
		}
		if (absenceNote) {
			return classifyVerdict({
				path,
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap: null,
				unmeasuredNote: absenceNote
			});
		}
		if (historyIncompleteNote) {
			return classifyVerdict({
				path,
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap: null,
				unmeasuredNote: historyIncompleteNote
			});
		}
		if (unstaged) {
			return classifyVerdict({
				path,
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap: null,
				unmeasuredNote:
					'unstaged bytes were compared without executing Git clean filters; they cannot prove fork ownership'
			});
		}
		if (rootOwnershipNote) {
			return classifyVerdict({
				path,
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap: null,
				unmeasuredNote: rootOwnershipNote
			});
		}
		if (!rootPaths.has(path)) {
			return classifyVerdict({
				path,
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap: null,
				unmeasuredNote:
					'path entered local history after repository creation; negative resemblance cannot prove fork ownership'
			});
		}
		return classifyVerdict({
			path,
			existsUpstream: true,
			baseMatchesUpstream: false,
			overlap: null,
			unmeasuredNote:
				'path existed in the bootstrap root, but bootstrap-time relocation or customization cannot be ruled out'
		});
	}

	if (upstreamEntry.type !== 'blob') {
		return classifyVerdict({
			path,
			existsUpstream: true,
			baseMatchesUpstream: false,
			overlap: null,
			unmeasuredNote: working.incompleteNote ?? 'upstream copy is a gitlink rather than a blob'
		});
	}

	if (baseEntry && baseEntry.sha === upstreamEntry.sha) {
		// Same bytes is not the same file. One blob is shared by a regular file
		// and a symlink pointing at that text, and by an executable and a
		// non-executable copy; only the mode tells them apart. Calling that
		// pristine claims the fork never touched a file whose semantics it did
		// in fact change.
		if (baseEntry.mode === upstreamEntry.mode)
			return classifyVerdict({ path, existsUpstream: true, baseMatchesUpstream: true });
		return classifyVerdict({
			path,
			existsUpstream: true,
			baseMatchesUpstream: false,
			overlap: null,
			unmeasuredNote: `upstream's bytes under a different mode (${baseEntry.mode} here, ${upstreamEntry.mode} upstream)`
		});
	}

	// Nothing at the base: the path is new here and upstream happens to have it
	// too. There is no "before" to compare, so this is unmeasured, and it is a
	// case worth seeing.
	if (!baseEntry)
		return classifyVerdict({
			path,
			existsUpstream: true,
			baseMatchesUpstream: false,
			unmeasuredNote: 'added here at a path upstream also has'
		});

	if (baseEntry.type !== 'blob') {
		return classifyVerdict({
			path,
			existsUpstream: true,
			baseMatchesUpstream: false,
			overlap: null,
			unmeasuredNote: 'the base copy is a gitlink rather than a blob'
		});
	}
	const baseBlob = localBlobs.get(baseEntry.sha);
	if (!baseBlob) {
		return classifyVerdict({
			path,
			existsUpstream: true,
			baseMatchesUpstream: false,
			overlap: null,
			unmeasuredNote: 'the base blob is absent from this partial clone'
		});
	}
	const upstreamBlob = upstreamBlobs.get(upstreamEntry.sha);
	const upstreamContent = upstreamBlob ? textOf(upstreamBlob) : null;
	if (upstreamContent === null) {
		return classifyVerdict({
			path,
			existsUpstream: true,
			baseMatchesUpstream: false,
			overlap: null,
			unmeasuredNote: upstreamBlob
				? 'upstream copy is not valid UTF-8 text'
				: 'upstream blob is absent from this partial clone'
		});
	}

	const overlapRepresentation = lineRepresentationCost(upstreamContent);
	if (overlapRepresentation > SIMILARITY_REPRESENTATION_LIMIT) {
		return classifyVerdict({
			path,
			existsUpstream: true,
			baseMatchesUpstream: false,
			overlap: null,
			unmeasuredNote: 'upstream text exceeds the bounded similarity representation'
		});
	}
	if (overlapRepresentation > upstream.similarityOperationsRemaining) {
		return classifyVerdict({
			path,
			existsUpstream: true,
			baseMatchesUpstream: false,
			overlap: null,
			unmeasuredNote: 'similarity comparison exceeded the bounded operation count'
		});
	}
	upstream.similarityOperationsRemaining -= overlapRepresentation;
	const upstreamLines = countLines(upstreamContent);

	const afterValues: Buffer[] = [];
	let incompleteNote = working.incompleteNote;
	const addAfterValue = (value: Buffer) => {
		if (!afterValues.some((existing) => existing.equals(value))) afterValues.push(value);
	};
	const addRepositoryState = (entry: TreeEntry | undefined) => {
		if (!entry) {
			addAfterValue(Buffer.alloc(0));
			return;
		}
		if (entry.type !== 'blob') {
			incompleteNote ??= 'one after-state is a gitlink rather than a blob';
			return;
		}
		const blob = localBlobs.get(entry.sha);
		if (blob) addAfterValue(blob);
		else incompleteNote ??= 'one after-state blob is unavailable from the bounded capture';
	};
	addRepositoryState(headTree.get(path));
	addRepositoryState(indexTree.get(path));
	if (working.missing) addAfterValue(Buffer.alloc(0));
	else for (const value of working.values) addAfterValue(value);

	let overlap: number | null = null;
	let sawBinary = false;
	for (const after of afterValues) {
		const captured = capturedDiff(baseBlob, after);
		if (captured.incompleteNote) incompleteNote ??= captured.incompleteNote;
		const diff = captured.output ? textOf(captured.output) : null;
		if (diff === null) {
			incompleteNote ??= 'one shared-path diff is not valid UTF-8 text';
			continue;
		}
		const score = regionOverlapWithLines(changedRegionLines(diff), upstreamLines);
		if (score !== null) overlap = overlap === null ? score : Math.max(overlap, score);
		sawBinary ||= /^Binary files/m.test(diff);
	}
	return classifyVerdict({
		path,
		existsUpstream: true,
		baseMatchesUpstream: false,
		overlap,
		unmeasuredNote:
			incompleteNote ??
			(sawBinary
				? 'binary file, no text to compare'
				: 'no comparable text in the change (mode-only or empty)')
	});
}

function callerPathspec(root: string, calledFrom: string, spec: string): string | null {
	const absolute = resolve(calledFrom, spec);
	const fromRoot = relative(root, absolute);
	if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return null;
	return (fromRoot || '.').split(sep).join('/');
}

function commandLineArguments() {
	try {
		return parseArgs({
			args: process.argv.slice(2),
			options: {
				base: { type: 'string' },
				fetch: { type: 'boolean', default: false },
				json: { type: 'boolean', default: false },
				all: { type: 'boolean', default: false }
			},
			allowPositionals: true,
			// Strict on purpose. With strict:false a mistyped `--bsae origin/main`
			// became a boolean flag plus a positional, and a positional replaces the
			// whole automatic file list, so the run checked one nonexistent path and
			// exited zero saying there was nothing to send upstream.
			strict: true
		});
	} catch (err) {
		fail(
			`Invalid upstream-report arguments: ${terminalSafe(err instanceof Error ? err.message : String(err))}`
		);
	}
}

function main() {
	const { values, positionals } = commandLineArguments();
	if (positionals.some((spec) => spec === '')) fail('Path arguments must not be empty.');

	const root = gitPath(['rev-parse', '--show-toplevel']);
	// Where the caller typed the command, kept because every path argument was
	// written relative to it. Resolving them after the chdir silently
	// reinterprets `../AGENTS.md` against the repository root, where it names
	// nothing, and an argument that matches nothing is fatal by design.
	const calledFrom = process.cwd();
	process.chdir(root);
	useScratchIndex(root);
	rejectUnverifiableFileModes();
	rejectUnsafePartialClone();

	const marker = readUpstreamMarker(root);
	requireCleanUpstreamMarker(marker);
	const head = git(['rev-parse', 'HEAD']);
	requireMarkerAtHead(head, marker);
	const local = localSnapshot(head, marker.bytes, callerShallowAtCopy);
	verifyScratchIndexEntries();
	const upstreamUrl = marker.url;
	const originUrlAtStart = configuredRemoteUrl('origin');
	if (originUrlAtStart) rejectUrlRewrite(originUrlAtStart);
	if (originUrlAtStart && sameRepository(originUrlAtStart, upstreamUrl)) {
		console.error('This repository IS the upstream template. Nothing to report upstream.');
		process.exit(2);
	}
	const baseResolution = resolveBase(head, values.base as string | undefined);
	const base = baseResolution.base;
	if (
		positionals.length > 0 &&
		git(['rev-parse', '--verify', '--quiet', `${base}:${MARKER}`], true) !==
			git(['rev-parse', '--verify', '--quiet', `${head}:${MARKER}`], true)
	) {
		fail(
			`${MARKER} changed in the selected commit range. Run without explicit paths so the parent change stays visible.`
		);
	}
	const upstream = ensureUpstream(root, upstreamUrl, values.fetch === true);
	const absenceNote = absenceUnmeasuredNote(marker, upstream);
	const identityNote = upstream.identityTrusted
		? undefined
		: 'the local upstream tree has no provenance from the configured upstream remote';
	const statusPaths = changedStatusPaths(local.status);
	const unstagedPaths = new Set(
		statusPaths.filter((entry) => entry.unstaged).map((entry) => entry.path)
	);
	const historyComplete = local.shallow === null;
	let paths: string[];
	if (positionals.length > 0) {
		// Each argument is resolved on its own, and one that matches nothing is
		// fatal even when its neighbours matched. Checking only the combined
		// result lets a valid path mask a typo beside it: git drops the unmatched
		// argument without a word, the list is still non-empty, and the run exits
		// zero having never looked at the file the caller meant.
		const requested = new Map<string, string[]>();
		const unmatched: string[] = [];
		for (const spec of positionals) {
			// Hand one canonical, repository-relative spelling to both readers. The
			// base lookup used to receive the raw argument after chdir, so a deleted
			// `config.ts` typed from `product/` looked for `/config.ts` instead.
			const pathspec = callerPathspec(root, calledFrom, spec);
			if (pathspec === null) {
				unmatched.push(spec);
				continue;
			}
			const specs = requested.get(pathspec);
			if (specs) specs.push(spec);
			else requested.set(pathspec, [spec]);
		}
		const enumerate = (): { resolved: Set<string>; unmatched: string[] } => {
			const resolved = new Set<string>();
			const missing: string[] = [];
			const addMatch = (match: string): void => {
				if (resolved.has(match)) return;
				if (resolved.size >= PATH_LIMIT) {
					fail(`Explicit paths matched more than ${PATH_LIMIT} files. Narrow the request.`);
				}
				resolved.add(match);
			};
			for (const [pathspec, specs] of requested) {
				const literalPathspec = `:(literal)${pathspec}`;
				let matched = false;
				const collect = (record: string) => {
					matched = true;
					addMatch(record);
				};
				try {
					gitZEach(
						[
							'ls-files',
							'-z',
							'--full-name',
							'--cached',
							'--others',
							'--exclude-standard',
							'--',
							literalPathspec
						],
						collect
					);
					// A path deleted in this change matches nothing in the working tree but
					// still exists at the base, and deleting template code is exactly the
					// sort of change worth reporting.
					gitZEach(
						['ls-tree', '-z', '--full-name', '--name-only', '-r', base, '--', literalPathspec],
						collect
					);
					gitZEach(
						['ls-tree', '-z', '--full-name', '--name-only', '-r', head, '--', literalPathspec],
						collect
					);
				} catch {
					fail(`Could not enumerate the requested path "${terminalSafe(specs[0]!)}".`);
				}
				if (!matched) missing.push(...specs);
			}
			return { resolved, unmatched: missing };
		};

		const first = enumerate();
		unmatched.push(...first.unmatched);
		if (unmatched.length > 0) {
			fail(
				`These paths matched nothing: ${unmatched.map(terminalSafe).join(', ')}\n` +
					'Refusing to report on the run. An unmatched path was never inspected and ' +
					'reads as "nothing to send upstream".'
			);
		}
		const resolved = [...first.resolved].sort();
		const confirmed = enumerate();
		const confirmedPaths = [...confirmed.resolved].sort();
		if (
			confirmed.unmatched.length > 0 ||
			resolved.length !== confirmedPaths.length ||
			resolved.some((path, index) => path !== confirmedPaths[index])
		) {
			fail('Explicit path expansion changed during this report. Run it again on the settled tree.');
		}
		paths = resolved;
	} else {
		const discovered = new Set(changedPaths(base, head));
		for (const { path } of statusPaths) {
			discovered.add(path);
			if (discovered.size > PATH_LIMIT) {
				fail(
					`Automatic discovery found more than ${PATH_LIMIT} changed paths. Narrow the request.`
				);
			}
		}
		paths = [...discovered];
	}
	if (positionals.length > 0) rejectHiddenIndexEntries(paths);
	const captured = capturePaths(paths);
	local.worktree = captured.fingerprints;
	const upstreamTree = readUpstream(upstream.sha);
	const historyIncompleteNote = !historyComplete
		? 'repository history is shallow, so earlier upstream ancestry is unknown'
		: !upstreamTree.historyComplete
			? 'upstream history did not complete, so earlier ancestry is unknown'
			: undefined;
	const baseTree = readTree(base);
	const headTree = readTree(head);
	const rootRead = gitPartialBytes(
		['rev-list', '--max-parents=0', head],
		undefined,
		HISTORY_COMMAND_TIMEOUT_MS
	);
	const rootCommits = rootRead.output.toString('utf8').trim().split('\n').filter(Boolean);
	const rootOwnershipNote = !rootRead.complete
		? 'repository root history did not complete within the bounded time'
		: rootCommits.length !== 1
			? 'repository history has multiple root commits, so creation-time path ownership is ambiguous'
			: undefined;
	const rootPaths = new Set<string>();
	if (!rootOwnershipNote) {
		for (const path of readTree(rootCommits[0]!).keys()) rootPaths.add(path);
	}
	const provenancePaths = new Set<string>();
	const provenancePathsByFold = new Set<string>();
	if (!absenceNote) {
		for (const commit of new Set(marker.provenance)) {
			for (const path of readTree(commit).keys()) {
				provenancePaths.add(path);
				provenancePathsByFold.add(path.toLowerCase());
			}
		}
	}
	const indexTree = readIndexTree();
	const history = new Map(
		paths.map((path) => [
			path,
			upstreamTree.tree.has(path)
				? { entries: [], complete: true }
				: readHistoricalEntries(head, path)
		])
	);
	const localEntries = paths.flatMap((path) => [
		baseTree.get(path),
		headTree.get(path),
		indexTree.get(path),
		...(history.get(path)?.entries ?? [])
	]);
	const localBlobs = readBlobs(
		[...new Set(localEntries.filter((entry) => entry?.type === 'blob').map((entry) => entry!.sha))],
		BLOB_BATCH_BYTES
	);
	const upstreamBlobs = readBlobs(
		[
			...new Set(
				paths
					.map((path) => upstreamTree.tree.get(path))
					.filter((entry) => entry?.type === 'blob')
					.map((entry) => entry!.sha)
			)
		],
		BLOB_BATCH_BYTES
	);
	const verdicts = paths.map((path) =>
		verdictFor(
			path,
			upstreamTree,
			baseTree,
			headTree,
			indexTree,
			localBlobs,
			upstreamBlobs,
			history.get(path)?.entries ?? [],
			rootPaths,
			provenancePaths,
			provenancePathsByFold,
			rootOwnershipNote,
			captured.contents.get(path) ?? { values: [], missing: true },
			unstagedPaths.has(path),
			historyIncompleteNote ??
				(history.get(path)?.complete === false
					? 'local history is incomplete, so earlier ancestry is unknown'
					: undefined),
			absenceNote,
			identityNote
		)
	);
	// The tree stays pinned while it is read, but a sync that moves the shared
	// ref before output would make an absent-path verdict obsolete. Abort instead.
	if (baseResolution.origin) verifyOriginSnapshot(baseResolution.origin);
	verifyTransportConfiguration();
	verifyScratchIndexEntries();
	verifyLocalSnapshot(root, local);
	// Keep the shared upstream ref as the last fence before output. Origin
	// validation can wait on the network while another worktree fetches upstream.
	verifyUpstreamSnapshot(upstreamUrl, upstream);

	if (values.json) {
		const output = JSON.stringify(
			{
				base,
				upstreamRef: upstreamTree.sha,
				upstreamUrl: redactUrl(upstreamUrl),
				// A machine caller gets the staleness the text renderer prints, or
				// it consumes comparisons from an old upstream tree unwarned.
				upstreamAgeDays: upstream.ageDays,
				upstreamAgeFrom: upstream.ageFrom,
				upstreamStale: upstream.ageDays !== null && upstream.ageDays >= STALE_AFTER_DAYS,
				verdicts
			},
			null,
			2
		);
		console.log(escapeOutputControls(output));
		return;
	}

	const reportable = verdicts.filter((v) => v.report);
	// Reading order, and the only place the overlap is allowed to matter. The
	// paths arrive alphabetised, which would put a 0% file above a 100% one
	// while the skill tells the reader to start at the top.
	const RANK: Record<Relevance, number> = {
		pristine: 0,
		unmeasured: 1,
		diverged: 2
	};
	const shown = verdicts
		.slice()
		.sort(
			(a, b) =>
				RANK[a.relevance] - RANK[b.relevance] ||
				(b.overlap ?? 0) - (a.overlap ?? 0) ||
				a.path.localeCompare(b.path)
		);

	console.log('');
	console.log(`Base: ${base.slice(0, 12)}   Upstream: ${upstreamTree.sha.slice(0, 12)}`);
	// Printed on every run. The age explains why absent paths remain unmeasured
	// and tells the reader when a fetch is worth the shared-state write.
	if (upstream.ageDays !== null) {
		console.log(
			`Local upstream copy: ${upstream.ageDays} day(s) old (by ${upstream.ageFrom}).` +
				(upstream.ageDays >= 1
					? ' This copy may miss ties; absent paths stay unmeasured until a run with `--fetch`.'
					: '')
		);
	}
	console.log('');
	if (shown.length === 0) {
		console.log('No changed file was found.');
	} else {
		for (const v of shown) {
			const mark = v.report ? '>>' : '  ';
			const displayPath = terminalSafe(v.path);
			const detail =
				v.relevance === 'diverged'
					? ` (${Math.round((v.overlap ?? 0) * 100)}% of what it replaced is upstream)`
					: v.relevance === 'unmeasured'
						? ` (${terminalSafe(v.note ?? '')})`
						: '';
			console.log(`${mark} ${v.relevance.padEnd(10)} ${displayPath}${detail}`);
		}
	}
	console.log('');
	const guesses = reportable.filter((v) => v.relevance === 'unmeasured').length;
	// An empty report and an unusable one read identically, and the warning
	// above does not survive the summary line: an agent that acts on the last
	// sentence stops. Only the empty case is rephrased, because a report with
	// something in it already sends the reader to the files.
	const stale = upstream.ageDays !== null && upstream.ageDays >= STALE_AFTER_DAYS;
	console.log(
		`${reportable.length} of ${verdicts.length} changed files need a look` +
			(guesses > 0 ? `, ${guesses} of them because the tie to upstream is unproven` : '') +
			'. ' +
			(reportable.length > 0
				? 'Read the change in each and decide whether the fix is upstream-shaped.'
				: stale
					? 'Nothing to report against a copy this old, which is not the same answer. ' +
						'Run `bun run upstream:report -- --fetch`.'
					: 'Nothing to report upstream.')
	);
}

// Measured on Bun 1.3.14: SIGINT reaches the exit listener and SIGTERM and
// SIGHUP do not, so those two leave the copy behind. A handler for them is the
// wrong answer and was measured to be worse: this file spends almost all of its
// time inside execFileSync, a JS handler cannot run until the event loop turns,
// and installing one only replaces the default disposition. The run then
// ignores SIGTERM entirely and needs SIGKILL. Sweeping on the way in cleans up
// after whatever killed the last run, which no handler can promise anyway.
if (import.meta.main) {
	process.on('exit', dropScratchIndex);
	main();
}
