import type { Component } from 'svelte';
import type { IconProps } from '@lucide/svelte';

// Lucide icon component type
type LucideIcon = Component<IconProps, object, ''>;

export interface NavItem {
	translationKey: string;
	url: string;
	icon?: LucideIcon;
	isActive?: boolean;
}

export interface HeaderConfig {
	icon: LucideIcon;
	titleKey: string;
	href: string;
}

export interface FooterLink {
	translationKey: string;
	url: string;
	icon: LucideIcon;
	condition?: boolean;
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
