export type ConsentDestination =
	{ kind: 'hosted'; host: string } | { kind: 'device' } | { kind: 'unknown' };

const isLoopback = (hostname: string) =>
	hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);

const WEB_HANDLER_SCHEMES = new Set([
	'bitcoin',
	'ftp',
	'ftps',
	'geo',
	'im',
	'irc',
	'ircs',
	'magnet',
	'mailto',
	'matrix',
	'mms',
	'news',
	'nntp',
	'openpgp4fpr',
	'sftp',
	'sip',
	'sms',
	'smsto',
	'ssh',
	'tel',
	'urn',
	'webcal',
	'wtai',
	'xmpp'
]);

const acceptsWebHandler = (protocol: string) =>
	protocol.startsWith('web+') || WEB_HANDLER_SCHEMES.has(protocol.slice(0, -1));

function parseUrl(value: string): URL | null {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

export function consentDestination(search: Pick<URLSearchParams, 'get'>): ConsentDestination {
	const url = parseUrl(search.get('redirect_uri') ?? '');
	if (url === null || acceptsWebHandler(url.protocol)) return { kind: 'unknown' };
	const web = url.protocol === 'http:' || url.protocol === 'https:';
	if (!web || isLoopback(url.hostname)) return { kind: 'device' };
	return { kind: 'hosted', host: url.host };
}
