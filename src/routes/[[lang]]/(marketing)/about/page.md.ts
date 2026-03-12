import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'About Us',
	description:
		'Meet the team presented on the public marketing site and understand the roles represented in the starter template.',
	sections: [
		{
			heading: 'Team overview',
			paragraphs: [
				'The about page presents a compact team roster for the marketing site. It is a brand and positioning page rather than a company directory or org chart.',
				'The page highlights cross-functional product, design, and go-to-market roles to frame the starter as a polished SaaS foundation.'
			]
		},
		{
			heading: 'Named team members',
			bullets: [
				'Liam Brown — Founder and CEO',
				'Elijah Jones — Co-Founder and CTO',
				'Isabella Garcia — Sales Manager',
				'Henry Lee — UX Engineer',
				'Ava Williams — Interaction Designer',
				'Olivia Miller — Visual Designer'
			]
		},
		{
			heading: 'What this page communicates',
			bullets: [
				'The starter is presented as a polished, product-ready system',
				'Design, engineering, and commercial roles are represented',
				'The page is intentionally high-level and descriptive rather than operational'
			]
		}
	]
};
