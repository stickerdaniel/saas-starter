import { browser } from '$app/environment';

const isMac = browser ? /Mac|iPhone|iPod|iPad/.test(navigator.platform) : true;

export const cmdOrCtrl = isMac ? '⌘' : 'Ctrl';
export const optionOrAlt = isMac ? '⌥' : 'Alt';
