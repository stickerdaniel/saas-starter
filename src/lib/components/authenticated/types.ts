import type { Component } from 'svelte';
import type { IconProps } from '@lucide/svelte';

// Lucide icon component type
type LucideIcon = Component<IconProps, object, ''>;

export interface NavSubItem {
	id: string;
	label: string;
	url: string;
	isActive?: boolean;
	/** Timestamp for relative time display (e.g. "3d ago") */
	timestamp?: number;
}

export interface NavItem {
	translationKey: string;
	url: string;
	icon?: LucideIcon;
	isActive?: boolean;
	badge?: number;
	/** When true, item has a collapsible toggle with sub-items */
	collapsible?: boolean;
	/** Sub-items shown under collapsible toggle */
	subItems?: NavSubItem[];
	/** Keyboard shortcut keys (e.g. ["⌘", "⇧", "1"]) */
	kbd?: string[];
	/** When true, clicking the main button does nothing (e.g. already on empty thread) */
	disableNav?: boolean;
}

export interface HeaderDropdownItem {
	translationKey: string;
	url: string;
	icon: LucideIcon;
}

export interface HeaderConfig {
	icon: LucideIcon;
	titleKey: string;
	href: string;
	dropdownItems?: HeaderDropdownItem[];
}

export interface FooterLink {
	translationKey: string;
	url: string;
	icon: LucideIcon;
	condition?: boolean;
	/** Keyboard shortcut keys (e.g. ["⌘", "."]) */
	kbd?: string[];
}

export interface SidebarConfig {
	header: HeaderConfig;
	navItems: NavItem[];
	footerLinks?: FooterLink[];
}

export interface User {
	name: string;
	email: string;
	image?: string;
	role?: string;
}
