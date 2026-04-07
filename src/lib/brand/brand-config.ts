/**
 * Cadenza brand prose.
 *
 * Single source of truth for every word that appears on a brand page.
 * Pages import from here — no inline copy. Edits happen here first.
 */

export const TAGLINE =
	'Cadenza is LinkedIn outreach that reads the room before it writes a word — written in your voice, sent only when it’s earned.';

export const NAME_STORY: readonly string[] = [
	'In music, a cadenza is the moment in a concerto where the orchestra falls silent and the soloist steps forward. It is brief. It is personal. It is the part of the piece an audience remembers — and the part the soloist has prepared for longer than any other.',
	'A cadenza is not a solo of self-indulgence. It is a solo of restraint: the soloist could play forever, and chooses not to. That choice is the art.',
	'This is what we want outreach to feel like. Not a broadcast. A moment.'
] as const;

export const OBSERVATION = {
	headline: 'Good outreach is a reading problem before it is a writing problem.',
	body: [
		'Every tool on the market is a writing tool. They generate, rewrite, personalize, A/B test, follow up. They optimize the wrong half of the equation. The bottleneck has never been what to say. The bottleneck is whether you understood the person you are saying it to.',
		'Cadenza inverts the stack. It reads first. It writes last. And most of the time, it suggests not writing at all — because the person isn’t ready, or the moment isn’t right, or there’s nothing the user could honestly say that wouldn’t sound like everyone else.'
	]
} as const;

export interface Lens {
	number: 1 | 2 | 3 | 4;
	thinker: string;
	title: string;
	takeaway: string;
	body: readonly string[];
}

export const LENSES: readonly Lens[] = [
	{
		number: 1,
		thinker: 'Bourdieu',
		title: 'Outreach is an exchange of symbolic capital',
		takeaway: 'Every message you send is an exchange of capital. Spend it like it’s yours.',
		body: [
			'Pierre Bourdieu argued that every social interaction is an exchange of capital — economic, social, cultural, symbolic. Symbolic capital is the prestige and recognition you carry when you walk into a room. It cannot be bought. It can only be earned, and it can be spent.',
			'Mass-broadcast outreach burns symbolic capital. Every templated message lowers the sender’s standing in a way the sender cannot see. The recipient files them under “person who does not understand the rules of the room.”',
			'Cadenza’s job is to spend symbolic capital deliberately, on the few moments it will compound, instead of bleeding it on the many that won’t.'
		]
	},
	{
		number: 2,
		thinker: 'Carnegie',
		title: 'Be interested before you are interesting',
		takeaway: 'Read before you write. Interest comes first. Interesting comes second.',
		body: [
			'Dale Carnegie’s How to Win Friends and Influence People is often misread as a manipulation manual. It is the opposite. Its central instruction is: become genuinely interested in other people. Listen. Remember names. Talk in terms of the other person’s interests. Make them feel important — and do it sincerely.',
			'Carnegie’s principle is the operating instruction for the entire product. Cadenza reads before it writes because Carnegie was right ninety years ago and is still right now.'
		]
	},
	{
		number: 3,
		thinker: 'Cialdini',
		title: 'The seven principles work because they’re human, not because they’re tricks',
		takeaway:
			'Influence works when it’s real. We don’t manufacture it. We help you notice when it’s already there.',
		body: [
			'Robert Cialdini’s seven principles of influence — reciprocity, commitment, social proof, authority, liking, scarcity, and unity — are not hacks. They are descriptions of how trust forms between humans.',
			'They fail, predictably and embarrassingly, the moment they are manufactured. Manufactured scarcity reads as desperation. Manufactured authority reads as arrogance. Manufactured liking reads as flattery. The principles only work when they are true — when the reciprocity is real, when the authority is earned, when the unity is felt.',
			'Cadenza takes the same position: we will not fake any of these. We will help you notice when one of them is genuinely present, and we will help you write to it. The rest of the time, we say nothing.'
		]
	},
	{
		number: 4,
		thinker: 'Castiglione',
		title: 'Sprezzatura — the art of concealing the work',
		takeaway:
			'Effortless is the most expensive thing to build. We do the work. You get the credit.',
		body: [
			'Baldassare Castiglione, 1528, The Book of the Courtier: sprezzatura — “a certain nonchalance, so as to conceal all art and make whatever one does or says appear to be without effort and almost without any thought about it.”',
			'Sprezzatura is not laziness. It is the deliberate hiding of effort. The cadenza that sounds improvised has been rehearsed for months. The message that lands like a personal note from a friend was the result of careful reading.',
			'Cadenza, the product, hides its work. The user writes one line. Behind that one line are hundreds of signals the product weighed and discarded. The user looks effortless. That is the entire promise.'
		]
	}
] as const;

export interface OgilvyRule {
	title: string;
	body: string;
}

export const OGILVY_RULES: readonly OgilvyRule[] = [
	{
		title: 'Tell the truth, but make the truth fascinating.',
		body: 'No one was ever bored into buying.'
	},
	{
		title: 'The consumer is not a moron. She is your wife.',
		body: 'Write to a single intelligent reader, never to a crowd.'
	},
	{
		title: 'Direct response is the discipline.',
		body: 'Every claim earns its keep. If we cannot measure it, we should not say it.'
	},
	{
		title: 'Long copy sells when it has something to say.',
		body: 'We are not afraid of words. We are afraid of words that do nothing.'
	},
	{
		title: 'Headlines are 80% of the work.',
		body: 'If the first line does not earn the second, nothing after it matters.'
	},
	{
		title: 'Research before you write.',
		body: 'Same instruction Carnegie gave, said by an adman.'
	}
] as const;

export interface PersonalityTrait {
	rank: 1 | 2 | 3 | 4 | 5;
	name: string;
	body: string;
}

export const PERSONALITY_TRAITS: readonly PersonalityTrait[] = [
	{
		rank: 1,
		name: 'Restrained',
		body: 'We say less. We do not exclaim. We do not capitalize for emphasis. We do not pad. The first edit is always to cut.'
	},
	{
		rank: 2,
		name: 'Observant',
		body: 'We notice things others miss. We name them precisely. We do not generalize when we can be specific.'
	},
	{
		rank: 3,
		name: 'Earned',
		body: 'Authority is shown, not claimed. We do not say “industry-leading.” We let the work say it.'
	},
	{
		rank: 4,
		name: 'Warm',
		body: 'Restraint is not coldness. We are kind, present, and on the user’s side. The product is a colleague, not a butler and not a boss.'
	},
	{
		rank: 5,
		name: 'Quietly confident',
		body: 'We are not nervous. We do not hedge. We do not apologize for taking up space. We just take up less of it than we are entitled to.'
	}
] as const;

export const POSITIONING = {
	statement:
		'For people whose career depends on the quality of a few important conversations, Cadenza is a LinkedIn outreach tool that reads before it writes. Unlike messaging tools that optimize volume and personalization at scale, Cadenza optimizes for the moment a message is genuinely worth sending — and helps you write it in your own voice when it is.',
	inCategory: 'LinkedIn outreach',
	notInCategory: 'sales engagement, sequencing, lead-gen automation, AI SDRs',
	frame: 'the reading tool that writes'
} as const;

export interface Value {
	title: string;
	refusal: string;
}

export const VALUES: readonly Value[] = [
	{
		title: 'Read before you write.',
		refusal: 'We will not ship a feature whose first action is to compose.'
	},
	{
		title: 'Less is more signal.',
		refusal:
			'We will not measure ourselves by messages sent. We will measure by replies that mattered.'
	},
	{
		title: 'Your voice, amplified.',
		refusal:
			'We will not generate text that sounds like us. Everything we suggest must sound like the user.'
	},
	{
		title: 'Earned attention.',
		refusal:
			'We will not buy reach we have not deserved. No dark patterns, no manufactured scarcity, no growth-hack copy.'
	}
] as const;

export interface VoiceRule {
	number: number;
	rule: string;
	body: string;
}

export const VOICE_RULES: readonly VoiceRule[] = [
	{
		number: 1,
		rule: 'Brevity signals confidence.',
		body: 'If you can cut a word, cut it. If you can cut a sentence, cut it harder.'
	},
	{
		number: 2,
		rule: 'Specificity over abstraction.',
		body: '“Reads 47 of their recent posts” beats “leverages contextual insights.” Always.'
	},
	{
		number: 3,
		rule: 'Active voice. Present tense.',
		body: 'Things happen. Now. Done by someone.'
	},
	{
		number: 4,
		rule: 'One exclamation mark per page, maximum.',
		body: 'And only when it has been earned by everything around it.'
	},
	{
		number: 5,
		rule: 'Lowercase by default.',
		body: 'Title case is reserved for proper nouns and the start of sentences. Sentence case in UI, headlines, and buttons.'
	},
	{
		number: 6,
		rule: 'No filler.',
		body: 'Banned: seamlessly, effortlessly, leverage, unlock, revolutionary, game-changing, AI-powered, supercharge, take it to the next level, in today’s fast-paced world.'
	}
] as const;

export interface VocabularyPair {
	say: string;
	dontSay: string;
}

export const VOCABULARY: readonly VocabularyPair[] = [
	{ say: 'outreach', dontSay: 'blast, campaign, cadence, sequence' },
	{ say: 'message', dontSay: 'touchpoint, asset, comms' },
	{ say: 'profile', dontSay: 'lead, target, prospect, contact' },
	{ say: 'context', dontSay: 'data, signal, intel' },
	{ say: 'voice', dontSay: 'tone, copy, content' },
	{ say: 'reads the room', dontSay: 'personalizes at scale' },
	{ say: 'in your voice', dontSay: 'AI-generated, AI-written' },
	{ say: 'earned attention', dontSay: 'growth hack, conversion lift' },
	{ say: 'the right moment', dontSay: 'optimal send time' },
	{ say: 'a message worth sending', dontSay: 'high-converting message' }
] as const;

export interface ToneRegister {
	context: string;
	dialPosition: string;
	example: string;
}

export const TONE_SPECTRUM: readonly ToneRegister[] = [
	{
		context: 'Marketing (homepage, landing)',
		dialPosition: 'Confident, slightly warm, grounded',
		example:
			'Most outreach tools help you write faster. Cadenza helps you decide whether to write at all.'
	},
	{
		context: 'Product UI (buttons, labels)',
		dialPosition: 'Functional, brief, helpful',
		example: 'Read profile / Suggest a message / Not yet'
	},
	{
		context: 'Errors & system messages',
		dialPosition: 'Direct, calm, useful',
		example: 'We couldn’t reach LinkedIn. Try again in a minute — nothing was sent.'
	},
	{
		context: 'Onboarding & empty states',
		dialPosition: 'Warm, guiding, never patronizing',
		example: 'Paste a profile to start. Cadenza will read it before it suggests anything.'
	}
] as const;

export const ANTI_BRAND: readonly string[] = [
	'A sales engagement platform.',
	'An “AI SDR.”',
	'A growth hack.',
	'A volume play.',
	'A productivity tool.',
	'A writing assistant.',
	'A CRM.',
	'“ChatGPT for LinkedIn.”'
] as const;

export interface MotionPrinciple {
	number: number;
	title: string;
	body: string;
}

export const MOTION_PRINCIPLES: readonly MotionPrinciple[] = [
	{
		number: 1,
		title: 'Purposeful.',
		body: 'Motion reinforces hierarchy or causality. If it does neither, it does not exist.'
	},
	{
		number: 2,
		title: 'Restrained.',
		body: 'Default duration: 200ms. Default easing: cubic-bezier(0.2, 0.8, 0.2, 1) (ease-out). Anything longer than 400ms must justify itself in a comment.'
	},
	{
		number: 3,
		title: 'Physical.',
		body: 'Things accelerate from rest and decelerate to rest. Nothing teleports.'
	},
	{
		number: 4,
		title: 'Quiet.',
		body: 'No spinners. Loading is a held breath, not a juggling act. Use shimmer, skeleton, or a single steady pulse.'
	},
	{
		number: 5,
		title: 'Reduced motion respected.',
		body: 'Every animation has a prefers-reduced-motion fallback. The fallback is “no animation,” not “less animation.”'
	}
] as const;

export interface ShaderCollection {
	name: string;
	use: string;
}

export const SHADER_COLLECTIONS: readonly ShaderCollection[] = [
	{ name: 'Vibrant Waves', use: 'Home hero. The reading metaphor as fluid attention.' },
	{ name: 'Quantum', use: 'Technology moments. Discrete points coalescing into shape.' },
	{ name: 'Heatwave', use: 'Warmth-forward moments — testimonials, founder notes.' },
	{ name: 'Oil Slick', use: 'Premium tier accents. Earned luxury.' },
	{ name: 'Ember', use: 'Footer atmospheres. Quiet glow.' }
] as const;

export const MOTION_PULLQUOTE = 'Motion should feel earned, not decorative.';
