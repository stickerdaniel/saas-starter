import { browser } from '$app/environment';

const isMac = browser ? /Mac|iPhone|iPod|iPad/.test(navigator.platform) : true;

export const cmdOrCtrl = isMac ? '⌘' : 'Ctrl';
export const ctrlSymbol = isMac ? '⌃' : 'Ctrl';
/** @public Kept for forks: Option/Alt sibling of cmdOrCtrl (AGENTS.md keyboard shortcut convention). */
export const optionOrAlt = isMac ? '⌥' : 'Alt';
