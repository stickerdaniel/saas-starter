import type { MarketingMarkdownContent } from './literals';

export interface MarkdownLink {
	label: MarketingMarkdownContent;
	href: string;
	description?: MarketingMarkdownContent;
}

export interface MarketingMarkdownSection {
	heading: MarketingMarkdownContent;
	paragraphs?: MarketingMarkdownContent[];
	bullets?: MarketingMarkdownContent[];
	links?: MarkdownLink[];
}

export interface MarketingMarkdownDocument {
	title: MarketingMarkdownContent;
	description: MarketingMarkdownContent;
	canonicalPath?: string;
	robots?: MarketingMarkdownContent;
	sections: MarketingMarkdownSection[];
}

export interface MarketingMarkdownRenderContext {
	origin: string;
	pathname: string;
	lang: string;
}
