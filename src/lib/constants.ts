// Pipeline states
export const PIPELINE_STATES = {
  PENDING_GENERATION: 'pending_generation',
  EMAIL_NOT_GENERATED: 'email_not_generated',
  PENDING_REVIEW: 'pending_review',
  APPROVED_TO_SEND: 'approved_to_send',
  SENT: 'sent',
} as const;

export type PipelineState = typeof PIPELINE_STATES[keyof typeof PIPELINE_STATES];

/*
 * Categorized catalog of target job titles for the onboarding picker.
 *
 * Grouped by function so users can scan + filter. The onboarding UI shows
 * one category at a time as a chip filter, plus a global search across all
 * categories. The flat TARGET_TITLES list below is derived from this so
 * the seed remains a single source of truth.
 *
 * Aliases live in TARGET_TITLE_ALIASES — they let "vp eng", "head of eng",
 * "engineering vp" all match "VP Engineering". Aliases only affect search;
 * the canonical title is what gets saved.
 */
export const TARGET_TITLE_CATEGORIES = {
  'Founders & Owners': [
    'Founder',
    'Co-Founder',
    'Founding Partner',
    'Owner',
    'Co-Owner',
    'Managing Partner',
    'General Partner',
    'Solo Founder',
    'Serial Entrepreneur',
  ],
  'Executive & C-Suite': [
    'CEO',
    'Chief Executive Officer',
    'President',
    'Managing Director',
    'General Manager',
    'Chairman',
    'Board Chair',
    'Executive Director',
    'Vice President',
    'Senior Vice President',
    'Executive Vice President',
  ],
  'Sales': [
    'CSO',
    'Chief Sales Officer',
    'CCO',
    'Chief Commercial Officer',
    'VP Sales',
    'VP of Sales',
    'Senior VP Sales',
    'Head of Sales',
    'Sales Director',
    'Director of Sales',
    'Regional Sales Director',
    'Enterprise Sales Director',
    'Sales Manager',
    'Account Executive',
    'Senior Account Executive',
    'Enterprise Account Executive',
    'Account Manager',
    'Sales Development Representative',
    'SDR Manager',
    'BDR Manager',
  ],
  'Revenue & Growth': [
    'CRO',
    'Chief Revenue Officer',
    'VP Revenue',
    'Head of Revenue',
    'Revenue Operations Director',
    'RevOps Director',
    'Head of Growth',
    'VP Growth',
    'Growth Lead',
    'Director of Growth',
    'Growth Manager',
    'Director of Demand Generation',
    'Demand Gen Manager',
  ],
  'Marketing': [
    'CMO',
    'Chief Marketing Officer',
    'VP Marketing',
    'VP of Marketing',
    'Head of Marketing',
    'Marketing Director',
    'Director of Marketing',
    'Director of Digital Marketing',
    'Director of Performance Marketing',
    'Director of Product Marketing',
    'Director of Brand',
    'Director of Content',
    'Director of Content Marketing',
    'Director of Field Marketing',
    'Director of Lifecycle Marketing',
    'Director of Marketing Operations',
    'Head of Brand',
    'Head of Content',
    'Head of Product Marketing',
    'Head of Performance Marketing',
    'Marketing Manager',
    'Brand Manager',
    'Product Marketing Manager',
    'Content Manager',
  ],
  'Communications & PR': [
    'Chief Communications Officer',
    'Head of Communications',
    'Communications Director',
    'Director of PR',
    'Director of Public Relations',
    'Head of PR',
    'Press Secretary',
    'Director of Investor Relations',
    'Head of Investor Relations',
    'Head of External Affairs',
  ],
  'Business Development': [
    'Chief Business Officer',
    'CBO',
    'VP Business Development',
    'Head of BD',
    'Head of Business Development',
    'Director of Business Development',
    'Director of Partnerships',
    'Head of Partnerships',
    'Partnerships Manager',
    'Strategic Partnerships Lead',
    'Alliance Manager',
  ],
  'Product': [
    'CPO',
    'Chief Product Officer',
    'VP Product',
    'VP of Product',
    'Head of Product',
    'Product Director',
    'Director of Product',
    'Director of Product Management',
    'Group Product Manager',
    'Principal Product Manager',
    'Senior Product Manager',
    'Product Manager',
    'Associate Product Manager',
    'Product Owner',
  ],
  'Engineering & Technology': [
    'CTO',
    'Chief Technology Officer',
    'VP Engineering',
    'VP of Engineering',
    'SVP Engineering',
    'Engineering Director',
    'Director of Engineering',
    'Head of Engineering',
    'Head of Platform',
    'Head of Infrastructure',
    'Engineering Manager',
    'Senior Engineering Manager',
    'Principal Engineer',
    'Staff Engineer',
    'Senior Software Engineer',
    'Software Engineer',
    'Tech Lead',
    'Technical Lead',
    'Architect',
    'Solutions Architect',
    'Principal Architect',
    'CIO',
    'Chief Information Officer',
    'IT Director',
    'Head of IT',
    'VP of IT',
    'IT Manager',
    'Director of DevOps',
    'Head of DevOps',
    'Site Reliability Engineering Lead',
    'SRE Lead',
    'Head of SRE',
    'Mobile Engineering Lead',
    'Frontend Engineering Lead',
    'Backend Engineering Lead',
  ],
  'AI & Machine Learning': [
    'Chief AI Officer',
    'CAIO',
    'Head of AI',
    'VP AI',
    'Director of AI',
    'AI Lead',
    'Head of AI Strategy',
    'Director of AI Strategy',
    'Head of Generative AI',
    'VP Generative AI',
    'Director of Generative AI',
    'Head of Applied AI',
    'Director of Applied AI',
    'AI Product Manager',
    'Senior AI Product Manager',
    'AI Platform Lead',
    'Head of AI Platform',
    'Head of Machine Learning',
    'VP Machine Learning',
    'Director of Machine Learning',
    'ML Engineering Manager',
    'Principal ML Engineer',
    'Staff ML Engineer',
    'Senior ML Engineer',
    'Machine Learning Engineer',
    'Applied AI Engineer',
    'Research Scientist',
    'Senior Research Scientist',
    'Head of Research',
    'Director of AI Research',
    'Senior Prompt Engineer',
    'Prompt Engineer',
    'AI Safety Lead',
    'Head of AI Safety',
    'MLOps Lead',
    'Head of MLOps',
  ],
  'Data & Analytics': [
    'CDO',
    'Chief Data Officer',
    'Chief Analytics Officer',
    'VP Data',
    'Head of Data',
    'Director of Data',
    'Director of Analytics',
    'Director of Data Science',
    'Head of Data Science',
    'Head of Analytics',
    'Head of Data Engineering',
    'Director of Data Engineering',
    'Analytics Manager',
    'Data Engineering Manager',
    'Data Science Manager',
    'Senior Data Scientist',
    'Data Scientist',
    'Senior Data Engineer',
    'Data Engineer',
    'Senior Analytics Engineer',
    'Analytics Engineer',
    'Business Intelligence Director',
    'Head of BI',
    'BI Manager',
  ],
  'Design': [
    'Chief Design Officer',
    'CDO Design',
    'VP Design',
    'VP of Design',
    'Head of Design',
    'Director of Design',
    'Director of Product Design',
    'Director of UX',
    'Head of UX',
    'Head of User Experience',
    'Design Manager',
    'Senior Design Manager',
    'Principal Designer',
    'Staff Designer',
    'Senior Product Designer',
    'Product Designer',
    'UX Lead',
    'UX Designer',
    'UX Researcher',
    'Head of UX Research',
    'Design Lead',
    'Brand Designer',
    'Creative Director',
    'Head of Creative',
  ],
  'Operations': [
    'COO',
    'Chief Operating Officer',
    'VP Operations',
    'VP of Operations',
    'Head of Operations',
    'Director of Operations',
    'Operations Director',
    'Operations Manager',
    'Director of Business Operations',
    'Head of BizOps',
    'BizOps Manager',
    'Head of Strategy',
    'Director of Strategy',
    'Chief of Staff',
    'Director of Program Management',
    'Head of Program Management',
    'Program Manager',
    'Senior Program Manager',
    'Director of Project Management',
    'PMO Director',
  ],
  'Finance & Accounting': [
    'CFO',
    'Chief Financial Officer',
    'VP Finance',
    'VP of Finance',
    'Head of Finance',
    'Finance Director',
    'Director of Finance',
    'Director of Financial Planning and Analysis',
    'Head of FP&A',
    'FP&A Director',
    'FP&A Manager',
    'Finance Manager',
    'Controller',
    'Corporate Controller',
    'Assistant Controller',
    'Chief Accounting Officer',
    'Director of Accounting',
    'Head of Accounting',
    'Accounting Manager',
    'Treasurer',
    'Head of Treasury',
    'Director of Tax',
    'Tax Manager',
    'Director of Procurement',
    'Head of Procurement',
  ],
  'People & Human Resources': [
    'CHRO',
    'Chief Human Resources Officer',
    'CPO People',
    'Chief People Officer',
    'VP People',
    'VP of People',
    'VP Human Resources',
    'Head of People',
    'Head of HR',
    'People Operations Director',
    'Director of People Operations',
    'Director of HR',
    'HR Director',
    'HR Manager',
    'People Operations Manager',
    'Head of Talent',
    'Director of Talent Acquisition',
    'Director of Recruiting',
    'Head of Recruiting',
    'Recruiting Manager',
    'Senior Recruiter',
    'Head of Learning and Development',
    'Director of L&D',
    'Head of DEI',
    'Director of Diversity Equity and Inclusion',
    'Head of Compensation and Benefits',
    'Total Rewards Director',
  ],
  'Customer Success & Support': [
    'Chief Customer Officer',
    'CCO Customer',
    'VP Customer Success',
    'VP of Customer Success',
    'Head of Customer Success',
    'Director of Customer Success',
    'CS Director',
    'Customer Success Manager',
    'Senior Customer Success Manager',
    'Enterprise CSM',
    'VP Customer Experience',
    'Head of Customer Experience',
    'Director of CX',
    'Head of Support',
    'Director of Customer Support',
    'Support Manager',
    'Head of Implementation',
    'Director of Implementation',
    'Head of Onboarding',
    'Onboarding Manager',
    'Director of Professional Services',
    'Head of Solutions',
    'Solutions Engineering Manager',
  ],
  'Information Security': [
    'CISO',
    'Chief Information Security Officer',
    'CSO Security',
    'Chief Security Officer',
    'VP Security',
    'VP of Security',
    'Head of Security',
    'Director of Security',
    'Security Director',
    'Head of Information Security',
    'Director of Information Security',
    'Head of Application Security',
    'AppSec Director',
    'Head of Cloud Security',
    'Director of Cloud Security',
    'Head of GRC',
    'Director of GRC',
    'Head of Governance Risk and Compliance',
    'Security Manager',
    'SecOps Manager',
    'Head of SecOps',
    'Director of Detection and Response',
    'Head of Incident Response',
  ],
  'Legal & Compliance': [
    'General Counsel',
    'GC',
    'Chief Legal Officer',
    'CLO',
    'Deputy General Counsel',
    'Associate General Counsel',
    'VP Legal',
    'Head of Legal',
    'Director of Legal',
    'Legal Director',
    'Legal Counsel',
    'Senior Counsel',
    'Corporate Counsel',
    'Chief Compliance Officer',
    'Director of Compliance',
    'Head of Compliance',
    'Compliance Manager',
    'Head of Privacy',
    'Director of Privacy',
    'Data Protection Officer',
    'DPO',
    'Head of Regulatory Affairs',
  ],
  'Healthcare & Life Sciences': [
    'Chief Medical Officer',
    'Chief Medical Information Officer',
    'CMIO',
    'Chief Nursing Officer',
    'CNO Nursing',
    'Chief Clinical Officer',
    'Medical Director',
    'VP Medical Affairs',
    'Head of Medical Affairs',
    'Director of Medical Affairs',
    'VP Clinical Operations',
    'Head of Clinical Operations',
    'Director of Clinical Operations',
    'Director of Clinical Research',
    'VP Clinical Research',
    'Principal Investigator',
    'Director of Pharmacy',
    'Director of Nursing',
    'Practice Manager',
    'Hospital Administrator',
    'VP Patient Experience',
    'Director of Patient Experience',
    'VP Patient Access',
    'Head of Revenue Cycle',
    'Director of Revenue Cycle Management',
    'Director of Quality and Safety',
    'Director of Pharmacovigilance',
    'Director of Bioinformatics',
    'Head of Real World Evidence',
  ],
  'Manufacturing & Supply Chain': [
    'Chief Supply Chain Officer',
    'CSCO',
    'VP Supply Chain',
    'Head of Supply Chain',
    'Director of Supply Chain',
    'Supply Chain Manager',
    'VP Manufacturing',
    'Head of Manufacturing',
    'Director of Manufacturing',
    'Plant Manager',
    'Operations Manager Manufacturing',
    'VP Logistics',
    'Head of Logistics',
    'Director of Logistics',
    'Logistics Manager',
    'VP Distribution',
    'Director of Distribution',
    'VP Procurement',
    'Director of Sourcing',
    'Head of Sourcing',
    'Director of Strategic Sourcing',
    'VP Quality',
    'Head of Quality',
    'Director of Quality',
    'Quality Manager',
    'Director of Demand Planning',
    'Head of Demand Planning',
    'S&OP Director',
    'Director of Warehouse Operations',
    'Warehouse Manager',
    'Director of Production',
    'Production Manager',
  ],
  'Retail & E-commerce': [
    'VP Merchandising',
    'Head of Merchandising',
    'Director of Merchandising',
    'Merchandising Manager',
    'VP E-commerce',
    'Head of E-commerce',
    'Director of E-commerce',
    'E-commerce Manager',
    'VP Digital',
    'Head of Digital',
    'Director of Digital',
    'VP Omnichannel',
    'Head of Omnichannel',
    'Director of Omnichannel',
    'VP Stores',
    'Head of Stores',
    'Director of Store Operations',
    'District Manager',
    'Regional Manager Retail',
    'VP Buying',
    'Head of Buying',
    'Director of Buying',
    'Category Manager',
    'Director of Category Management',
    'VP Retail Operations',
    'Director of Retail Operations',
    'Director of Visual Merchandising',
  ],
  'Education': [
    'Provost',
    'Vice Provost',
    'Dean',
    'Associate Dean',
    'Head of School',
    'School Principal',
    'Superintendent',
    'Assistant Superintendent',
    'Chief Academic Officer',
    'VP Academic Affairs',
    'VP Enrollment Management',
    'Director of Enrollment',
    'Director of Admissions',
    'Director of Student Affairs',
    'Director of Financial Aid',
    'Director of Institutional Research',
    'Director of Curriculum',
    'Chief Learning Officer',
    'CLO Learning',
    'VP Learning and Development',
    'Director of Online Learning',
    'Head of EdTech',
  ],
  'Real Estate & Facilities': [
    'Chief Real Estate Officer',
    'VP Real Estate',
    'Head of Real Estate',
    'Director of Real Estate',
    'VP Leasing',
    'Head of Leasing',
    'Director of Leasing',
    'Property Manager',
    'Director of Property Management',
    'Asset Manager',
    'VP Asset Management',
    'Director of Asset Management',
    'Portfolio Manager Real Estate',
    'VP Portfolio Management',
    'VP Facilities',
    'Head of Facilities',
    'Director of Facilities',
    'Facilities Manager',
    'Director of Workplace',
    'Head of Workplace Experience',
    'Director of Construction',
    'VP Construction',
  ],
  'Hospitality & Travel': [
    'General Manager Hotel',
    'Hotel General Manager',
    'VP Hotel Operations',
    'Director of Hotel Operations',
    'Director of Rooms',
    'Director of Food and Beverage',
    'F&B Director',
    'Director of Catering',
    'Director of Events',
    'Director of Housekeeping',
    'Director of Front Office',
    'VP Guest Experience',
    'Head of Guest Experience',
    'Director of Revenue Management Hotel',
    'Director of Sales and Marketing Hotel',
    'Resort Manager',
    'VP Restaurant Operations',
    'Director of Restaurant Operations',
  ],
  'Public Sector & Government': [
    'City Manager',
    'County Administrator',
    'Town Manager',
    'Chief Administrative Officer Public',
    'Chief Information Officer Public Sector',
    'Director of Government Affairs',
    'VP Government Affairs',
    'Head of Government Affairs',
    'Head of Public Affairs',
    'Director of Public Policy',
    'Head of Policy',
    'Policy Director',
    'VP Federal Sales',
    'Director of Federal Sales',
    'Director of State and Local Sales',
    'Director of Public Sector',
    'Head of Public Sector',
    'Director of Citizen Services',
    'Director of Constituent Services',
  ],
  'Developer Relations & Community': [
    'VP Developer Relations',
    'Head of Developer Relations',
    'Director of Developer Relations',
    'DevRel Lead',
    'Head of Developer Experience',
    'Director of Developer Experience',
    'DX Lead',
    'Senior Developer Advocate',
    'Developer Advocate',
    'Head of Community',
    'Director of Community',
    'Community Manager',
    'Head of Open Source',
    'Open Source Program Manager',
    'Director of Open Source',
    'Head of Technical Content',
    'Director of Technical Content',
  ],
} as const;

export type TargetTitleCategory = keyof typeof TARGET_TITLE_CATEGORIES;

/*
 * Search-only aliases. Map of alternate keywords/phrasings to the canonical
 * title in TARGET_TITLE_CATEGORIES. The UI matches user input against this
 * AND the canonical names — saves the canonical name regardless.
 *
 * Lowercase only. No exact duplicates of canonical (canonical is already
 * searched directly).
 */
export const TARGET_TITLE_ALIASES: Record<string, string[]> = {
  CEO: ['chief executive', 'ceo founder'],
  CTO: ['chief technology', 'cto founder'],
  CMO: ['chief marketing'],
  CFO: ['chief financial', 'finance chief'],
  COO: ['chief operating', 'operations chief'],
  CPO: ['chief product'],
  CRO: ['chief revenue'],
  CISO: ['chief security', 'security chief', 'information security chief'],
  CHRO: ['chief people', 'chief hr', 'people chief'],
  CDO: ['chief data'],
  CCO: ['chief commercial'],
  CBO: ['chief business'],
  CAIO: ['chief ai', 'ai chief'],
  'VP Engineering': ['vp eng', 'engineering vp', 'eng vp'],
  'VP of Engineering': ['vp eng', 'engineering vp', 'eng vp'],
  'VP Sales': ['vp of sales'],
  'VP Marketing': ['vp of marketing'],
  'VP Product': ['vp of product'],
  'VP Operations': ['vp of operations', 'vp ops'],
  'Head of Engineering': ['eng lead', 'engineering lead'],
  'Head of Product': ['product lead'],
  'Head of Marketing': ['marketing lead'],
  'Head of Sales': ['sales lead'],
  'Head of People': ['head of hr', 'people lead'],
  'Head of HR': ['head of people', 'hr lead'],
  'Head of Operations': ['head of ops', 'ops lead'],
  'Head of Customer Success': ['cs lead', 'head of cs'],
  'Director of Operations': ['ops director'],
  'Director of Engineering': ['eng director'],
  'Director of Product': ['product director'],
  'Director of Marketing': ['marketing director'],
  'Director of Sales': ['sales director'],
  'Director of Customer Success': ['cs director'],
  Founder: ['startup founder'],
  'Co-Founder': ['cofounder', 'co founder'],
  'General Counsel': ['gc', 'top lawyer'],
  'Solutions Architect': ['sa', 'solution architect'],
  'Senior Software Engineer': ['sr engineer', 'senior engineer'],
  'Software Engineer': ['swe', 'engineer'],
  'Data Scientist': ['ds'],
  'Machine Learning Engineer': ['ml engineer', 'mle'],
  'Product Manager': ['pm', 'prod manager'],
  'Senior Product Manager': ['sr pm', 'sr product manager'],
  'Account Executive': ['ae'],
  'Sales Development Representative': ['sdr'],
  'Customer Success Manager': ['csm'],
  'Site Reliability Engineering Lead': ['sre lead'],
  'Director of People Operations': ['people ops director', 'peoplops director'],
  'Director of Talent Acquisition': ['ta director', 'recruiting director'],
  'Head of Recruiting': ['talent lead', 'head of talent'],
  // Newer AI roles
  'Head of Generative AI': ['head of genai', 'head of gen ai'],
  'AI Product Manager': ['ai pm'],
  'Prompt Engineer': ['llm engineer', 'prompt eng'],
  'MLOps Lead': ['ml ops', 'mlops'],
  // Healthcare
  'Chief Medical Officer': ['cmo medical', 'chief medical'],
  'Chief Medical Information Officer': ['cmio', 'medical cio'],
  'Chief Nursing Officer': ['cno', 'nursing chief'],
  'VP Clinical Operations': ['vp clin ops', 'clinical ops vp'],
  'Director of Clinical Operations': ['clin ops director'],
  'Director of Pharmacovigilance': ['pv director'],
  'Director of Pharmacy': ['pharmacy director'],
  // Manufacturing / supply chain
  'Chief Supply Chain Officer': ['csco'],
  'VP Supply Chain': ['vp scm', 'supply chain vp'],
  'Head of Supply Chain': ['scm lead', 'supply chain lead'],
  'Plant Manager': ['factory manager', 'site manager'],
  'VP Manufacturing': ['mfg vp'],
  'S&OP Director': ['sop director', 'sandop director'],
  'Director of Demand Planning': ['demand planning lead'],
  // Retail / e-com
  'VP E-commerce': ['vp ecom', 'ecommerce vp'],
  'Head of E-commerce': ['ecom lead', 'ecommerce lead'],
  'Director of E-commerce': ['ecom director'],
  'VP Omnichannel': ['omnichannel vp'],
  'VP Merchandising': ['merch vp'],
  'Head of Merchandising': ['merch lead'],
  'District Manager': ['dm retail'],
  // Education
  Provost: ['academic provost'],
  Dean: ['college dean', 'faculty dean'],
  'School Principal': ['school head', 'k12 principal'],
  'Director of Admissions': ['admissions director'],
  'Head of EdTech': ['edtech lead'],
  // Real estate / facilities
  'VP Real Estate': ['re vp'],
  'Head of Facilities': ['facilities lead', 'workplace lead'],
  'Head of Workplace Experience': ['workplace experience lead', 'wx lead'],
  // Hospitality
  'General Manager Hotel': ['hotel gm', 'gm hotel'],
  'Director of Food and Beverage': ['f&b director', 'fnb director'],
  // Public sector
  'City Manager': ['town manager'],
  'Director of Government Affairs': ['gov affairs director', 'public affairs director'],
  'VP Federal Sales': ['fed sales vp'],
  // DevRel
  'Head of Developer Relations': ['devrel lead', 'head of devrel'],
  'Director of Developer Relations': ['devrel director'],
  'Senior Developer Advocate': ['sr devrel', 'sr developer advocate'],
  'Developer Advocate': ['devrel', 'da'],
  'Head of Developer Experience': ['dx lead', 'head of dx'],
  'Head of Community': ['community lead'],
  'Head of Open Source': ['oss lead', 'open source lead', 'ospo lead'],
};

// Flat seed list derived from the catalog. Each registered user gets their
// own copy on registration; the onboarding picker pre-selects all of these
// as a sensible default. Order preserved from the catalog so highest-value
// titles surface first in Apollo searches (priority = array index).
export const TARGET_TITLES = Object.values(TARGET_TITLE_CATEGORIES).flat() as readonly string[];

// Default system prompt seeded for new users. Follows the Email Drafter
// skill's framework (Subject / Greeting / Opening / Body / CTA / Closing),
// adapted for cold initial outreach. New users should edit the WHO YOU ARE
// block with their specific credibility before sending real emails.
//
// Placeholders injected at generation time:
//   {{SENDER_COMPANY_NAME}} / {{SENDER_COMPANY_WEBSITE}} / {{SENDER_NAME}}
//   {{COMPANY_NAME}} / {{COMPANY_WEBSITE_URL}}
//   {{CONTACT_FIRST_NAME}} / {{CONTACT_LAST_NAME}} / {{CONTACT_TITLE}}
export const DEFAULT_SYSTEM_PROMPT = `ROLE
You are an expert at composing professional, effective business cold emails. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

WHO YOU ARE (the sender)
You represent {{SENDER_COMPANY_NAME}}. EDIT THIS SECTION before sending real emails: add your background, 1-3 credibility anchors (previous companies / traction metrics / technical specialties), and a one-line positioning statement of the form "I help [WHO] do [OUTCOME] through [HOW]". If this section is left as the default, the model will fetch {{SENDER_COMPANY_WEBSITE}} via url-context and infer the sender's background from the public site, but explicit anchors here improve email quality dramatically.

WHO YOU ARE WRITING TO
{{CONTACT_FIRST_NAME}} {{CONTACT_LAST_NAME}}, {{CONTACT_TITLE}} at {{COMPANY_NAME}} ({{COMPANY_WEBSITE_URL}}).

TOOLS AVAILABLE
You have two live tools: url-context (fetch URLs in the prompt) and google-search (query the public web). Use both before writing. Do not rely on training data alone, especially for Series A and growth-stage companies the training data does not cover.

REQUIRED RESEARCH (do these in order before writing)
1. Fetch COMPANY_WEBSITE_URL with url-context. Read the homepage and the product or features page. Capture: what they actually build, who their users are, and one specific feature you can reference by name.
2. Fetch SENDER_COMPANY_WEBSITE so you accurately represent the sender.
3. Run one google-search for "{{COMPANY_NAME}}" plus the most relevant signal (funding, hiring, product launch). Note recent activity worth referencing.

EMAIL STRUCTURE (Email Drafter framework, adapted for first-touch cold outreach)

1. SUBJECT — Clear, specific, actionable. 5 to 9 words. Names a concrete artifact the recipient owns or a specific system you noticed during research. No all caps. No emojis. No clickbait punctuation.

2. GREETING — "Hi {{CONTACT_FIRST_NAME}}," on its own line. Initial outreach calls for formal-but-warm. Not "Dear" (too formal), not "Hey" (too casual for first contact).

3. OPENING — Context and purpose. ONE sentence. Establish you are writing because of something specific you observed during research. Bridge from cold to conversation by referencing a real, named thing they shipped or wrote.

4. BODY — Exactly TWO key points. Each in its own short paragraph (1 to 3 sentences).
   POINT 1 — Credibility. One sentence anchoring the sender (drawn from WHO YOU ARE).
   POINT 2 — Concrete observation tied to THEIR stack. Name the specific system, page, or workflow you fetched in research. State the one thing you would build, analyze, or propose for them. Must be specific to them, not generic.

5. CALL TO ACTION — What you need. ONE sentence. Peer-to-peer, soft. If the sender has set a calendar link in their signature or in WHO YOU ARE, include it; otherwise propose a quick call directly.

6. CLOSING — Professional sign-off. "Best," or "Best regards," followed by {{SENDER_NAME}} on the next line. NOTHING after the name. No P.S. No soft opt-out line.

TONE
Formal-but-warm (Email Drafter's "Formal" tier — recommended for initial outreach). Confident, curious, peer-to-peer, slightly understated. Write like a senior practitioner reaching out to another senior practitioner, not like an SDR running a campaign.

LENGTH
60 to 130 words total from greeting through closing inclusive.

FORBIDDEN
- Words: "synergy", "leverage", "circle back", "innovative", "revolutionary", "cutting-edge", "game-changer", "in this competitive landscape", "I hope this finds you well", "just wanted to reach out", "quick question", "5 minutes of your time".
- Punctuation: em-dashes (use parentheses or commas instead), exclamation marks.
- Format: emojis, bullet points (use short paragraphs), P.S., postscript trick, double CTA.
- Honesty rule: never invent product names, features, customer logos, or metrics. Use ONLY facts confirmed by the tool calls.

OUTPUT FORMAT (return ONLY this JSON, nothing else):
{
  "subject": "Subject line, 5 to 9 words, specific to {{COMPANY_NAME}}",
  "email_body": "Hi {{CONTACT_FIRST_NAME}},\\n\\n[Opening — context and purpose, one sentence]\\n\\n[Point 1 — credibility, one sentence]\\n\\n[Point 2 — concrete observation about their stack plus what you would do]\\n\\n[CTA]\\n\\nBest,\\n{{SENDER_NAME}}"
}`;

// Default follow-up prompts seeded for new users on first registration.
// Each follows the Email Drafter "Follow-Up" pattern adapted for the
// specific intent of that step:
//   step 1 — Day 3 quick bump (Professional tone)
//   step 2 — Day 7 value-add (Friendly tone — relationship is warming)
//   step 3 — Day 14 break-up (Friendly but final)
//
// Additional placeholders these prompts use beyond the initial set:
//   {{ORIGINAL_SUBJECT}} / {{ORIGINAL_BODY}} — content of the unanswered
//   initial email, injected so the model can reference what was sent.
export const DEFAULT_FOLLOWUP_PROMPTS = [
  {
    step: 1,
    dayOffset: 3,
    name: 'Day 3 · Quick follow-up',
    content: `ROLE
You are an expert at composing professional, effective business follow-up emails. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent the email below 3 days ago. The recipient has not replied. Write the first follow-up. This goes out in the SAME Gmail thread.

WHO YOU ARE (the sender)
Inherit context from the initial prompt. The sender is the same person who sent {{ORIGINAL_SUBJECT}}.

WHO YOU ARE WRITING TO
{{CONTACT_FIRST_NAME}} {{CONTACT_LAST_NAME}}, {{CONTACT_TITLE}} at {{COMPANY_NAME}} ({{COMPANY_WEBSITE_URL}}).

ORIGINAL EMAIL (unanswered after 3 days)
Subject: {{ORIGINAL_SUBJECT}}
Body:
{{ORIGINAL_BODY}}

TOOLS AVAILABLE
url-context (fetch URLs) and google-search. Use them to check whether anything NEW has happened at {{COMPANY_NAME}} since the initial email — a launch, a hire, a funding round, a public post worth referencing. If you find something fresh, weave it in. If not, do a clean structural bump without faking specifics.

EMAIL STRUCTURE (Email Drafter Follow-Up framework, adapted)

1. SUBJECT — "Re: {{ORIGINAL_SUBJECT}}". Same subject prefixed with "Re:" so Gmail threads it under the original conversation.

2. GREETING — "Hi {{CONTACT_FIRST_NAME}}," on its own line.

3. OPENING — Acknowledge the prior thread without overusing follow-up language. ONE sentence. Pattern options (vary across emails):
   (a) "Bumping this in case it slipped past the inbox."
   (b) "Re-reading your [specific thing on their site] reminded me I sent this last week."
   (c) "One quick add to the note below."

4. BODY — ONE key point. Max 2 sentences. EITHER:
   (a) A new specific observation from your research (a feature they shipped this week, a hire, a recent post).
   (b) A one-line reinforcement of the value angle from the original — phrased differently from the first email.
   Never re-pitch. Never re-list credentials.

5. CALL TO ACTION — One short line. Soft. If the sender has a calendar link in WHO YOU ARE or in their signature, reference it; otherwise propose a quick reply.

6. CLOSING — "Best," followed by {{SENDER_NAME}} on the next line. NOTHING after.

TONE
Professional. Treat the recipient as a busy peer who legitimately missed the first email.

LENGTH
25 to 60 words total.

FORBIDDEN
- "Just following up", "checking in", "wanted to make sure you saw this", "did you have a chance".
- Re-stating credentials. Re-stating the original pitch in full.
- Em-dashes, exclamation marks, emojis, P.S.

OUTPUT FORMAT (return ONLY this JSON):
{
  "subject": "Re: {{ORIGINAL_SUBJECT}}",
  "email_body": "Hi {{CONTACT_FIRST_NAME}},\\n\\n[Opening — bump or new observation, one sentence]\\n\\n[Body — one key point, max two sentences]\\n\\n[CTA]\\n\\nBest,\\n{{SENDER_NAME}}"
}`,
  },
  {
    step: 2,
    dayOffset: 7,
    name: 'Day 7 · Value-add',
    content: `ROLE
You are an expert at composing professional, value-driven follow-up emails. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent the initial email 7 days ago. The recipient has not replied. Write the value-add follow-up. Day 7 is the "give without asking" slot — the email should read like a peer sharing a relevant observation, NOT another sales attempt. This is sent in the same Gmail thread.

WHO YOU ARE
Inherit context from the initial prompt. Same sender as {{ORIGINAL_SUBJECT}}.

WHO YOU ARE WRITING TO
{{CONTACT_FIRST_NAME}} {{CONTACT_LAST_NAME}}, {{CONTACT_TITLE}} at {{COMPANY_NAME}} ({{COMPANY_WEBSITE_URL}}).

ORIGINAL EMAIL (unanswered after 7 days)
Subject: {{ORIGINAL_SUBJECT}}
Body:
{{ORIGINAL_BODY}}

TOOLS AVAILABLE
url-context and google-search. Day 7's job is to surface something fresh. Spend the research budget here: re-fetch the recipient's site, look for new pages or features, search for any public activity (a recent post, a podcast appearance, a press mention).

EMAIL STRUCTURE (Email Drafter Follow-Up framework, value-add variant)

1. SUBJECT — "Re: {{ORIGINAL_SUBJECT}}". Same thread.

2. GREETING — "Hi {{CONTACT_FIRST_NAME}}," on its own line.

3. OPENING — Implicitly acknowledge the thread without saying "following up". ONE sentence that bridges directly into the value. Pattern options:
   (a) "Quick thought after [specific thing from their site or recent activity]:"
   (b) "Saw [X] this week and circled back to the note below."
   (c) "One more observation on [their-thing] before I close this thread out."

4. BODY — ONE key point. Concrete value with NO ask attached. 2 to 4 sentences.
   - A specific observation from your research that shows you read deeper than the first email.
   - A relevant technical insight tied to their stack.
   - A question that surfaces real expertise.
   - A reference to a public resource (NOT to {{SENDER_COMPANY_WEBSITE}}).

5. CALL TO ACTION — Soft, optional calendar link. If the sender has a calendar in WHO YOU ARE or signature, reference it; otherwise propose a quick reply.

6. CLOSING — "Best," followed by {{SENDER_NAME}} on the next line. NOTHING after.

TONE
Friendly. Per Email Drafter: friendly tone applies once the relationship is warming. By Day 7 the recipient has seen two of your emails.

LENGTH
50 to 100 words total.

FORBIDDEN
- "Hope you don't mind another note", "wanted to share", "just in case you missed it".
- Re-stating credentials or original pitch.
- Em-dashes, exclamation marks, emojis, P.S.

OUTPUT FORMAT (return ONLY this JSON):
{
  "subject": "Re: {{ORIGINAL_SUBJECT}}",
  "email_body": "Hi {{CONTACT_FIRST_NAME}},\\n\\n[Opening — bridge to value, one sentence]\\n\\n[Body — concrete value-add, 2 to 4 sentences]\\n\\n[CTA]\\n\\nBest,\\n{{SENDER_NAME}}"
}`,
  },
  {
    step: 3,
    dayOffset: 14,
    name: 'Day 14 · Break-up',
    content: `ROLE
You are an expert at composing graceful business break-up emails. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent the initial email 14 days ago and two follow-ups since. The recipient has not replied. THIS IS THE FINAL EMAIL — no further follow-ups will be sent. The break-up email has the highest reply rate of all follow-ups because it removes social pressure: the recipient can either re-engage now or be left alone forever. Sent in the same Gmail thread.

WHO YOU ARE
Inherit context from the initial prompt.

WHO YOU ARE WRITING TO
{{CONTACT_FIRST_NAME}} {{CONTACT_LAST_NAME}}, {{CONTACT_TITLE}} at {{COMPANY_NAME}} ({{COMPANY_WEBSITE_URL}}).

ORIGINAL EMAIL (unanswered after 14 days)
Subject: {{ORIGINAL_SUBJECT}}
Body:
{{ORIGINAL_BODY}}

TOOLS AVAILABLE
url-context and google-search. You do not need deep research for a break-up — a single check for anything dramatically new at {{COMPANY_NAME}} (a new round, a new hire) is enough.

EMAIL STRUCTURE (Email Drafter Follow-Up framework, break-up variant)

1. SUBJECT — "Re: {{ORIGINAL_SUBJECT}}". Same thread.

2. GREETING — "Hi {{CONTACT_FIRST_NAME}}," on its own line.

3. OPENING — ONE sentence that closes the loop gracefully without self-pity. Pattern options:
   (a) "Last note from me on this thread."
   (b) "Closing the file on this one for now."
   (c) "Should I assume the timing isn't right?"

4. BODY — ONE short paragraph. Make it easy for them to re-engage with a single yes or no:
   - Offer to circle back next quarter if priorities shift.
   - Acknowledge the timing may simply be wrong.
   - Optionally ask if someone else on their team is the right contact (forward-friendly).

5. CALL TO ACTION — Optional in the break-up. Either include the calendar (if the sender has one) as a "door open" gesture, or let the body itself be the soft CTA.

6. CLOSING — "Best," followed by {{SENDER_NAME}} on the next line. NOTHING after.

TONE
Friendly but final. Relaxed, non-needy, almost amused. The reader should feel let off the hook, not guilt-tripped.

LENGTH
25 to 60 words total.

FORBIDDEN
- "Sorry to bother you", "I understand if you're not interested", "this is my last attempt".
- Self-pity. Guilt-trip phrasing.
- Em-dashes, exclamation marks, emojis, P.S.

OUTPUT FORMAT (return ONLY this JSON):
{
  "subject": "Re: {{ORIGINAL_SUBJECT}}",
  "email_body": "Hi {{CONTACT_FIRST_NAME}},\\n\\n[Opening — graceful close]\\n\\n[Body — one short paragraph, door-open framing]\\n\\n[Optional CTA]\\n\\nBest,\\n{{SENDER_NAME}}"
}`,
  },
] as const;

// =============================================================================
// LinkedIn channel defaults
// =============================================================================
// Parallel set of prompts for the LinkedIn DM channel. Output is a single
// short message — NO subject, NO links (LinkedIn shadow-filters them in
// first-touch messages). Same placeholder set as the email prompts, minus
// {{ORIGINAL_SUBJECT}} (LinkedIn has no subject thread anchor).
//
// Length targets (from 2026 LinkedIn outreach research):
//   initial      — 50 to 90 words / 350 to 600 characters
//   step 1 (D3)  — 20 to 45 words
//   step 2 (D7)  — 35 to 70 words (value-add)
//   step 3 (D14) — 18 to 40 words (break-up)
//
// JSON output shape: { "message": "..." }
export const DEFAULT_LINKEDIN_INITIAL_PROMPT = `ROLE
You are an expert at writing short, high-reply LinkedIn cold messages. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

WHO YOU ARE (the sender)
You represent {{SENDER_COMPANY_NAME}}. EDIT THIS SECTION before sending real messages: add 1-2 credibility anchors (previous companies, traction, or a sharp positioning statement). If left as the default the model will fetch {{SENDER_COMPANY_WEBSITE}} and infer, but explicit anchors here dramatically improve message quality.

WHO YOU ARE WRITING TO
{{CONTACT_FIRST_NAME}} {{CONTACT_LAST_NAME}}, {{CONTACT_TITLE}} at {{COMPANY_NAME}} ({{COMPANY_WEBSITE_URL}}).

TOOLS AVAILABLE
url-context (fetch URLs) and google-search. Use them before writing — LinkedIn cold messages reward specificity more than email does because the recipient is one tap away from your profile.

REQUIRED RESEARCH
1. Fetch COMPANY_WEBSITE_URL. Capture one named product, feature, or workflow.
2. Fetch SENDER_COMPANY_WEBSITE briefly so you represent the sender accurately.
3. google-search "{{COMPANY_NAME}}" plus the strongest live signal you can find (funding, hiring, product launch, public post). Note one specific thing worth referencing.

CHANNEL CONTEXT
This is a LinkedIn DM, not an email. It will be pasted by the sender into either (a) a direct message to a 1st-degree connection, (b) an InMail to a 2nd or 3rd-degree, or (c) the note field of a connection request (in which case the sender will manually trim to fit). Write for the DM case as the default — but keep it punchy enough that trimming is painless.

MESSAGE STRUCTURE
1. OPENER — ONE sentence. Reference the specific signal you found. No "Hi {{CONTACT_FIRST_NAME}}," — LinkedIn already shows the recipient's name. Open straight into the observation. Pattern options (vary):
   (a) "Saw [specific signal] — [one-line read on what it means]."
   (b) "Your [specific artifact on their site or post] caught me because [one-line reason]."
   (c) "[Compact observation about their stack, named feature, recent post]."
2. BRIDGE — ONE sentence. Connect the observation to a real, named thing you would do, build, or notice for them. Specific to them, not generic. Do not pitch features.
3. ASK — ONE sentence. Frictionless. A question they can answer in a single line, OR a permission ask ("worth a 15-minute swap if [specific topic] is on your radar?"). Never propose a meeting in the first message unless the sender's calendar is explicitly in WHO YOU ARE.

TONE
Peer-to-peer. Slightly understated. Confident. Read like a senior practitioner sending one DM to one person, not like a sequence.

LENGTH
50 to 90 words. Hard cap: 600 characters including spaces. Top-quartile LinkedIn cold messages cluster at 50-75 words because mobile readers will not scroll.

FORBIDDEN
- Greeting block ("Hi {{CONTACT_FIRST_NAME}},", "Hello", "Hey there"). LinkedIn shows the name already.
- Sign-off block ("Best,", "Regards,", "Cheers,", "{{SENDER_NAME}}"). DMs are not letters.
- Links. LinkedIn shadow-filters first-touch messages that contain URLs.
- Words: "synergy", "leverage", "circle back", "innovative", "revolutionary", "game-changer", "I hope this finds you well", "I am reaching out", "quick question", "5 minutes of your time", "thoughts?", "let me know".
- Punctuation: em-dashes (use parentheses or a comma), exclamation marks, ellipses.
- Format: emojis, line breaks inside the message (LinkedIn collapses them), bullet points.
- Honesty rule: never invent product names, features, customer logos, or metrics. Use only facts confirmed by the tool calls.

OUTPUT FORMAT (return ONLY this JSON, nothing else):
{
  "message": "[50 to 90 words. Opener + bridge + ask. No greeting. No sign-off. No links.]"
}`;

export const DEFAULT_LINKEDIN_FOLLOWUP_PROMPTS = [
  {
    step: 1,
    dayOffset: 3,
    name: 'Day 3 · LinkedIn nudge',
    content: `ROLE
You are an expert at writing short LinkedIn follow-up messages. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent the LinkedIn message below 3 days ago. The recipient has not replied. Write the first follow-up. It will be sent as a new DM in the same conversation (LinkedIn does not thread like email — each message stands alone but appears under the previous one).

WHO YOU ARE
Inherit context from the initial prompt. Same sender as the original message.

WHO YOU ARE WRITING TO
{{CONTACT_FIRST_NAME}} {{CONTACT_LAST_NAME}}, {{CONTACT_TITLE}} at {{COMPANY_NAME}} ({{COMPANY_WEBSITE_URL}}).

ORIGINAL LINKEDIN MESSAGE (unanswered after 3 days)
{{ORIGINAL_BODY}}

TOOLS AVAILABLE
url-context and google-search. Lightly check whether anything new happened at {{COMPANY_NAME}} in the last 3 days — a hire, a launch, a post. If yes, weave it in. If no, do a clean structural bump without faking specifics.

MESSAGE STRUCTURE
Single short paragraph. Pattern options (pick the one that fits the situation):
(a) "Bumping this in case it slid past — [one new specific reason it's relevant]."
(b) "[One new specific observation from your fresh research], which made me circle back to my note above."
(c) "Realised I should have asked it differently: [reframed one-line question]."

End with the same low-friction ask from the original, phrased a different way. No new pitch.

TONE
Light. Peer-to-peer. A real person noticing the silence without being annoyed about it.

LENGTH
20 to 45 words. Hard cap: 300 characters.

FORBIDDEN
- "Just following up", "checking in", "wanted to make sure you saw this", "did you have a chance", "bumping this up to the top".
- Re-stating credentials or re-pitching.
- Greeting block. Sign-off block. Sender name on a new line.
- Links. Em-dashes. Exclamation marks. Emojis.

OUTPUT FORMAT (return ONLY this JSON):
{
  "message": "[Single short paragraph, 20 to 45 words, with a varied one-line ask]"
}`,
  },
  {
    step: 2,
    dayOffset: 7,
    name: 'Day 7 · LinkedIn value-add',
    content: `ROLE
You are an expert at writing value-driven LinkedIn DMs. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent the initial LinkedIn message 7 days ago and one nudge 4 days ago. Still no reply. This is the value-add slot — give them something useful with no ask attached. Day 7 has the highest reply rate of any follow-up on LinkedIn because it inverts the dynamic: you are no longer asking, you are giving.

WHO YOU ARE
Inherit context from the initial prompt.

WHO YOU ARE WRITING TO
{{CONTACT_FIRST_NAME}} {{CONTACT_LAST_NAME}}, {{CONTACT_TITLE}} at {{COMPANY_NAME}} ({{COMPANY_WEBSITE_URL}}).

ORIGINAL LINKEDIN MESSAGE (unanswered after 7 days)
{{ORIGINAL_BODY}}

TOOLS AVAILABLE
url-context and google-search. Spend the research budget here. Re-fetch their site. Look for new pages, new posts, podcast appearances, press mentions, hires. The whole point of Day 7 is to surface something fresh and specific.

MESSAGE STRUCTURE
Single paragraph.
1. ONE-line observation specific to them, drawn from your fresh research. Not a re-statement of anything in the original.
2. ONE concrete piece of value tied to that observation: a technical insight, a relevant public resource (link is okay here — Day 7 is past the first-touch filter window), or a question that surfaces real expertise. NO ask attached to the value.
3. ONE optional, softer-than-before ask. If the sender has a calendar in WHO YOU ARE, you may include it. Otherwise let the message stand without an ask.

TONE
Warm. Confident. Reads like a peer sharing a thought, not an SDR closing a sequence.

LENGTH
35 to 70 words. Hard cap: 500 characters.

FORBIDDEN
- "Hope you don't mind another note", "wanted to share", "just in case you missed it", "circling back one more time".
- Re-stating credentials or original pitch.
- Greeting block. Sign-off block.
- Em-dashes. Exclamation marks. Emojis.

OUTPUT FORMAT (return ONLY this JSON):
{
  "message": "[35 to 70 words, value-first, optional soft ask, no greeting, no sign-off]"
}`,
  },
  {
    step: 3,
    dayOffset: 14,
    name: 'Day 14 · LinkedIn break-up',
    content: `ROLE
You are an expert at writing graceful LinkedIn break-up DMs. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent three LinkedIn messages over the last 14 days. No reply. THIS IS THE FINAL DM — no further follow-ups will be sent. The break-up message has the highest reply rate of the entire sequence on LinkedIn because it removes the social pressure: the recipient can either re-engage now or be left alone forever.

WHO YOU ARE
Inherit context from the initial prompt.

WHO YOU ARE WRITING TO
{{CONTACT_FIRST_NAME}} {{CONTACT_LAST_NAME}}, {{CONTACT_TITLE}} at {{COMPANY_NAME}} ({{COMPANY_WEBSITE_URL}}).

ORIGINAL LINKEDIN MESSAGE (unanswered after 14 days)
{{ORIGINAL_BODY}}

TOOLS AVAILABLE
url-context and google-search. You do not need deep research for a break-up. A single check for anything dramatically new at {{COMPANY_NAME}} (a new round, a new hire, an acquisition) is enough — and useful only if it directly affects whether the original ask still applies.

MESSAGE STRUCTURE
Single short paragraph. Pick ONE pattern and adapt:
(a) "Closing the loop on this one — happy to circle back if [their named priority] becomes urgent."
(b) "Last note from me — if I am off on timing or fit, no offense taken. Door is open."
(c) "Should I assume timing is off? Forward-friendly if there is a better person on your side to talk to."

TONE
Relaxed. Non-needy. Almost amused. The recipient should feel let off the hook, not guilt-tripped. The phrasing should make a one-word "actually, yes" reply feel easy.

LENGTH
18 to 40 words. Hard cap: 280 characters.

FORBIDDEN
- "Sorry to bother you", "I understand if you are not interested", "this is my last attempt", "no hard feelings".
- Self-pity. Guilt-trip phrasing. Apologising.
- Greeting block. Sign-off block.
- Links unless the sender has a calendar in WHO YOU ARE.
- Em-dashes. Exclamation marks. Emojis.

OUTPUT FORMAT (return ONLY this JSON):
{
  "message": "[18 to 40 words, relaxed close, door-open framing]"
}`,
  },
] as const;

// Apollo API configuration
export const APOLLO_API_BASE_URL = 'https://api.apollo.io/api/v1';

// Gemini model configuration.
// gemini-3.5-flash: GA (released May 2026, internal 3.5-flash-05-2026). 1M input /
// 65k output context, supports googleSearch + urlContext grounding in one request,
// faster and cheaper than the prior gemini-3-pro-preview used for generation.
export const GEMINI_MODEL = 'gemini-3.5-flash';
