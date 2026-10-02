type DeviceNavigator = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>;

/** iPadOS can identify as a Mac; Android also reports Linux. Check those first. */
export function getPasskeyDevice(navigator?: DeviceNavigator) {
	if (!navigator) return 'other';
	const { userAgent, platform, maxTouchPoints } = navigator;
	if (/iPad/i.test(userAgent) || (/Mac/i.test(platform) && maxTouchPoints > 1)) {
		return 'ipad';
	}
	if (/iPod/i.test(userAgent)) return 'ipod';
	if (/iPhone/i.test(userAgent)) return 'iphone';
	if (/Android/i.test(userAgent)) return 'android';
	if (/CrOS/i.test(userAgent)) return 'chromebook';
	if (/Mac/i.test(platform) || /Macintosh/i.test(userAgent)) return 'mac';
	if (/Win/i.test(platform) || /Windows/i.test(userAgent)) return 'windows';
	if (/Linux/i.test(platform) || /Linux/i.test(userAgent)) return 'linux';
	return 'other';
}
