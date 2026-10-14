'use strict';
// scripts/_sample-team-content.js
// The invented words of the "Northwind Product" sample team: names, squads,
// sprint goals, bug titles, documents and meeting notes. Plain data, no logic,
// no clock and no randomness - scripts/sample-team.js turns it into the
// examples/sample-team/ds-data tree. Everything here is fictional: no real
// person, company, customer or host. ASCII only.

const DOMAIN = 'northwind.example';

// Six squads, four people each. `key` is the Jira-style project key used in
// every issue key of the tree; `area` is the cost / settlement area where the
// modules know one (atlas, borealis, comet, delta).
const SQUADS = [
  {
    id: 'atlas', name: 'Atlas', key: 'ATL', area: 'atlas', focus: 'Orders', kb: 'orders',
    people: [
      ['Alex', 'Morgan', 'Product Owner'],
      ['Sam', 'Rivera', 'Engineer'],
      ['Priya', 'Raman', 'Engineer'],
      ['Tomas', 'Novak', 'QA Engineer'],
    ],
    epics: [
      ['ATL-1', 'Order editing after checkout'],
      ['ATL-2', 'Bulk order import'],
    ],
    goals: [
      'Let buyers change quantities on an open order',
      'Show the order history on one screen',
      'Ship the bulk order import for the first ten accounts',
      'Cut the order list load time under one second',
      'Add reorder with one click',
      'Harden order editing after the first customer feedback',
    ],
  },
  {
    id: 'borealis', name: 'Borealis', key: 'BOR', area: 'borealis', focus: 'Checkout', kb: 'checkout',
    people: [
      ['Elena', 'Rossi', 'Product Owner'],
      ['Jordan', 'Lee', 'Engineer'],
      ['Aiko', 'Tanaka', 'Designer'],
      ['Samir', 'Haddad', 'Engineer'],
    ],
    epics: [
      ['BOR-1', 'Faster checkout'],
      ['BOR-2', 'Saved payment terms'],
    ],
    goals: [
      'Reduce checkout to three steps',
      'Remember the delivery address per account',
      'Roll out saved payment terms to pilot accounts',
      'Fix the rounding differences in order totals',
      'Add the order summary email',
      'Stabilise checkout after the August release',
    ],
  },
  {
    id: 'comet', name: 'Comet', key: 'CMT', area: 'comet', focus: 'Catalog', kb: 'catalog',
    people: [
      ['Grace', 'Whitfield', 'Product Owner'],
      ['Taylor', 'Kim', 'Engineer'],
      ['Ingrid', 'Solberg', 'Engineer'],
      ['Kofi', 'Mensah', 'QA Engineer'],
    ],
    epics: [
      ['CMT-1', 'Catalog import pipeline'],
      ['CMT-2', 'Product variants'],
    ],
    goals: [
      'Import a supplier catalog without manual cleanup',
      'Model product variants for size and colour',
      'Validate imported prices before they go live',
      'Support product images in the import',
      'Show import errors in plain language',
      'Reach a clean import for the largest supplier file',
    ],
  },
  {
    id: 'delta', name: 'Delta', key: 'DLT', area: 'delta', focus: 'Deliveries', kb: 'delivery',
    people: [
      ['Hannah', 'Weiss', 'Product Owner'],
      ['Dmitri', 'Volkov', 'Engineer'],
      ['Leila', 'Karimi', 'Designer'],
      ['Oscar', 'Lindqvist', 'Engineer'],
    ],
    epics: [
      ['DLT-1', 'Delivery tracking'],
      ['DLT-2', 'Delivery slot booking'],
    ],
    goals: [
      'Show live delivery status on the order page',
      'Let buyers pick a delivery slot',
      'Notify buyers when a delivery is delayed',
      'Connect the first two carriers',
      'Print delivery labels in the warehouse view',
      'Handle partial deliveries end to end',
    ],
  },
  {
    id: 'echo', name: 'Echo', key: 'ECH', area: null, focus: 'Search', kb: 'search',
    people: [
      ['Zoe', 'Carter', 'Product Owner'],
      ['Rafael', 'Costa', 'Engineer'],
      ['Nadia', 'Petrova', 'Engineer'],
      ['Jonas', 'Berg', 'QA Engineer'],
    ],
    epics: [
      ['ECH-1', 'Search relevance'],
      ['ECH-2', 'Saved filters'],
    ],
    goals: [
      'Rank exact product codes first',
      'Add typo tolerance to product search',
      'Ship saved filters on the order list',
      'Measure search success with a daily report',
      'Tune synonyms for the top fifty queries',
      'Cut zero-result searches by a third',
    ],
  },
  {
    id: 'falcon', name: 'Falcon', key: 'FAL', area: null, focus: 'Platform', kb: 'platform',
    people: [
      ['Amara', 'Diallo', 'Product Owner'],
      ['Felix', 'Moreau', 'Engineer'],
      ['Yuki', 'Sato', 'Designer'],
      ['Chloe', 'Dubois', 'Engineer'],
    ],
    epics: [
      ['FAL-1', 'Public API v2'],
      ['FAL-2', 'Audit log'],
    ],
    goals: [
      'Publish the first version of the public API',
      'Add rate limits and clear error codes',
      'Record who changed what in an audit log',
      'Move background jobs to the new queue',
      'Document the API with runnable examples',
      'Reach the agreed uptime for the API gateway',
    ],
  },
];

// Issue titles, per squad, used for sprint issues and worklogs.
const ISSUE_TITLES = {
  atlas: [
    'Edit quantities on an open order', 'Order history table with filters', 'Confirm dialog before cancelling an order',
    'Reorder button on past orders', 'Import orders from a CSV file', 'Validation messages for the import',
    'Order detail page loads slowly', 'Totals recalculated after an edit', 'Export the order list to CSV',
    'Keyboard shortcuts on the order list', 'Audit trail for order edits', 'Empty state for new accounts',
  ],
  borealis: [
    'Collapse checkout into three steps', 'Remember the delivery address', 'Payment terms selector',
    'Order summary email template', 'Fix rounding in the daily totals', 'Coupon field on the last step',
    'Mobile layout of the payment step', 'Retry a failed payment', 'Show tax per line item',
    'Autofill company details', 'Progress indicator for checkout', 'Error message when stock runs out',
  ],
  comet: [
    'Parse supplier CSV with semicolons', 'Variant model for size and colour', 'Price sanity check on import',
    'Import product images from a zip', 'Plain-language import errors', 'Bulk edit product categories',
    'Duplicate detection by product code', 'Preview an import before publishing', 'Unit conversion for packs',
    'Archive discontinued products', 'Import progress bar', 'Template download for suppliers',
  ],
  delta: [
    'Delivery status timeline', 'Slot picker for delivery dates', 'Delay notification email',
    'Carrier connector for the first carrier', 'Carrier connector for the second carrier', 'Label printing from the warehouse view',
    'Partial delivery handling', 'Proof of delivery upload', 'Track a parcel by order number',
    'Delivery cost rules per region', 'Warehouse pick list export', 'Cut-off time banner',
  ],
  echo: [
    'Exact product code match ranks first', 'Typo tolerance for product names', 'Saved filters on the order list',
    'Daily search quality report', 'Synonym list for frequent queries', 'Zero-result page with suggestions',
    'Search as you type', 'Highlight matches in results', 'Filter by availability',
    'Recent searches per user', 'Boost best sellers', 'Search analytics events',
  ],
  falcon: [
    'Public API authentication', 'Rate limiting per key', 'Consistent error codes',
    'Audit log storage', 'Audit log viewer', 'Queue migration for background jobs',
    'API reference with examples', 'Webhook delivery retries', 'API gateway health checks',
    'Key rotation without downtime', 'Pagination for list endpoints', 'Sandbox environment for partners',
  ],
};

// Production bug titles per area (the prod-bugs module groups by area).
const BUG_TITLES = {
  orders: [
    'Order total shows the old price after an edit', 'Cancelled order still appears in the open list',
    'Duplicate confirmation email after a quick double click', 'Order history filter forgets the date range',
    'CSV export cuts off long product names', 'Reorder button disabled for archived products',
    'Order note disappears when the page is reloaded', 'Wrong currency symbol on the order PDF',
    'Bulk import skips the last row of a file', 'Edit dialog opens twice on slow connections',
  ],
  otherModules: [
    'Search ignores the exact product code on the second page', 'Delivery slot shows the wrong weekday',
    'Imported image is shown rotated', 'Variant picker resets after adding to the order',
    'Carrier name missing in the tracking email', 'Price shown without tax for one account type',
    'Label print preview is blank in one browser', 'Synonym list ignores capital letters',
    'Partial delivery marked as complete', 'Category tree collapses after saving',
    'Typo tolerance returns unrelated products', 'Stock badge shows zero for large packs',
  ],
  platform: [
    'API returns 500 for an empty filter list', 'Rate limit header missing on error responses',
    'Webhook retried more often than configured', 'Audit log entry missing for key rotation',
    'Gateway health check reports healthy during a restart', 'Pagination cursor repeats the last item',
    'Sandbox keys expire after one day instead of seven', 'Queue worker stops after a long job',
    'Wrong content type on the error page', 'Token refresh fails near midnight UTC',
    'Slow query on the audit log search', 'Duplicate webhook after a manual retry',
  ],
};

// Topics for sprint review sessions.
const REVIEW_TOPICS = [
  'Demo of the new flow with two pilot accounts', 'What we learned from the support tickets',
  'Before and after: page load time', 'Open questions for the next sprint',
  'A look at the numbers behind the goal', 'Walkthrough of the new settings page',
  'Customer feedback in their own words', 'The one thing that did not work and why',
];

// Roadmap initiatives (roadmap module, discovery-tasks/dt-*.json).
const INITIATIVES = [
  ['Order editing after checkout', 'NW-101', 'atlas', 'delivery', 'green'],
  ['Bulk order import', 'NW-102', 'atlas', 'delivery', 'green'],
  ['Faster checkout', 'NW-103', 'borealis', 'pilot', 'green'],
  ['Saved payment terms', 'NW-104', 'borealis', 'solution-space', 'amber'],
  ['Catalog import pipeline', 'NW-105', 'comet', 'delivery', 'red'],
  ['Product variants', 'NW-106', 'comet', 'solution-space', 'green'],
  ['Delivery tracking', 'NW-107', 'delta', 'delivery', 'green'],
  ['Delivery slot booking', 'NW-108', 'delta', 'problem-space', 'green'],
  ['Search relevance', 'NW-109', 'echo', 'pilot', 'green'],
  ['Saved filters', 'NW-110', 'echo', 'delivery', 'amber'],
  ['Public API v2', 'NW-111', 'falcon', 'solution-space', 'red'],
  ['Audit log', 'NW-112', 'falcon', 'problem-space', 'green'],
  ['Customer portal for returns', 'NW-113', 'atlas', 'preparation', 'green'],
  ['Multi-warehouse stock view', 'NW-114', 'delta', 'preparation', 'green'],
  ['Partner sandbox', 'NW-115', 'falcon', 'preparation', 'green'],
];

// Knowledge base documents. area -> category folder -> file. Original text.
const DOCS = [
  {
    area: 'orders', category: 'research', slug: 'order-editing-interviews', date: '2026-07-09', type: 'research',
    author: 'Alex Morgan', title: 'What buyers told us about editing orders',
    summary: 'Six short interviews about why buyers change an order after sending it.',
    body: [
      '## Why we asked', '',
      'Support receives a steady stream of "can you change my order" requests. We wanted to know what buyers try first and where they give up.', '',
      '## What we heard', '',
      '- Most changes are small: a quantity, a delivery date or a forgotten item.',
      '- Buyers expect to edit until the warehouse starts picking.',
      '- Nobody reads the help page; they look for an Edit button on the order itself.', '',
      '## What we will do', '',
      'Make editing available on the order page and show clearly when an order is locked and why.',
    ],
  },
  {
    area: 'orders', category: 'estimates', slug: 'bulk-import-estimate', date: '2026-07-22', type: 'estimate',
    author: 'Sam Rivera', title: 'Estimate: bulk order import',
    summary: 'Rough sizing of the CSV import for orders, in story points.',
    body: [
      '## Scope', '',
      'Upload a CSV, show a preview with errors, create the orders in one go.', '',
      '## Sizing', '',
      '| Part | Points |', '|---|---|',
      '| Upload and parsing | 5 |', '| Preview with validation | 8 |', '| Create orders in the background | 5 |', '| Error report | 3 |', '',
      'Total: 21 points, about one and a half sprints for one squad.',
    ],
  },
  {
    area: 'checkout', category: 'data-analysis', slug: 'checkout-drop-off', date: '2026-08-04', type: 'analysis',
    author: 'Elena Rossi', title: 'Where buyers leave the checkout',
    summary: 'Step-by-step drop-off for the five-step checkout, July 2026.',
    body: [
      '## Numbers', '',
      'Of 1,000 buyers who start checkout, 880 reach the address step, 790 the payment step and 720 finish.', '',
      '## Reading', '',
      'The biggest single drop is between the cart and the address step. Buyers who already have a saved address finish far more often.', '',
      '## Next', '',
      'Collapse the first two steps and remember the address per account.',
    ],
  },
  {
    area: 'checkout', category: 'notes', slug: 'payment-terms-notes', date: '2026-08-18', type: 'note',
    author: 'Aiko Tanaka', title: 'Notes: saved payment terms workshop',
    summary: 'What we agreed with finance about showing payment terms at checkout.',
    body: [
      '## Decisions', '',
      '- Payment terms are shown as a short label, never as a table.',
      '- Terms come from the account, buyers cannot change them.',
      '- An overdue account sees a gentle reminder, not a block.', '',
      '## Open', '',
      'Who decides what "overdue" means for accounts with disputed invoices?',
    ],
  },
  {
    area: 'catalog', category: 'as-is', slug: 'supplier-import-today', date: '2026-07-14', type: 'as-is',
    author: 'Grace Whitfield', title: 'How a supplier catalog gets into the system today',
    summary: 'The current manual import, step by step, with the pain points.',
    body: [
      '## The flow', '',
      '1. A supplier emails a spreadsheet.', '2. Someone in operations cleans the columns by hand.',
      '3. A developer runs a script to load it.', '4. Prices are checked in a second spreadsheet.', '',
      '## Pain points', '',
      'Every step waits for a person. A typical import takes three days and fails about one time in four.',
    ],
  },
  {
    area: 'catalog', category: 'ux-brief', slug: 'import-errors-brief', date: '2026-08-25', type: 'brief',
    author: 'Taylor Kim', title: 'Brief: import errors people can act on',
    summary: 'Design brief for the error report shown after a catalog import.',
    body: [
      '## Goal', '',
      'After an import, a non-developer should know what is wrong with row 42 and how to fix it.', '',
      '## Principles', '',
      '- One sentence per error, in the words of the spreadsheet column.',
      '- Group repeated errors, show three examples.',
      '- Offer a corrected file to download.',
    ],
  },
  {
    area: 'delivery', category: 'interviews', slug: 'warehouse-visit', date: '2026-07-30', type: 'interview',
    author: 'Hannah Weiss', title: 'Warehouse visit: how pickers use delivery labels',
    summary: 'Observations from half a day on the warehouse floor.',
    body: [
      '## Setting', '',
      'Two pickers, one shift lead, a busy Tuesday morning.', '',
      '## Observations', '',
      '- Labels are printed in batches of ten, never one by one.',
      '- A missing carrier name sends the parcel back to a manual queue.',
      '- Gloves make small buttons hard to hit.', '',
      '## Ideas', '',
      'Batch printing, larger buttons, and a visible carrier on every label preview.',
    ],
  },
  {
    area: 'delivery', category: 'workshop', slug: 'slot-booking-workshop', date: '2026-09-02', type: 'workshop',
    author: 'Leila Karimi', title: 'Workshop: delivery slot booking',
    summary: 'Outcome of a two-hour workshop with sales, support and the warehouse.',
    body: [
      '## Who joined', '',
      'Sales, support, the warehouse lead and two engineers.', '',
      '## Outcome', '',
      'Slots are offered per region, three per day, and close at 14:00 the day before. Exceptions go through support.',
    ],
  },
  {
    area: 'search', category: 'research', slug: 'zero-result-searches', date: '2026-08-11', type: 'research',
    author: 'Zoe Carter', title: 'Why searches return nothing',
    summary: 'A look at 500 zero-result searches from July.',
    body: [
      '## Method', '',
      'We read 500 searches that returned no results and grouped them by cause.', '',
      '## Causes', '',
      '- 38 percent: typos in product names.',
      '- 27 percent: product codes with spaces or dashes.',
      '- 19 percent: words the catalog does not use.',
      '- 16 percent: products that really do not exist.',
    ],
  },
  {
    area: 'search', category: 'business-requirements', slug: 'saved-filters-requirements', date: '2026-09-08', type: 'requirements',
    author: 'Rafael Costa', title: 'Requirements: saved filters',
    summary: 'What saved filters must do in the first release.',
    body: [
      '## Must have', '',
      '- Save the current filters under a name.', '- Apply a saved filter with one click.', '- Rename and delete saved filters.', '',
      '## Later', '',
      'Share a saved filter with the team.',
    ],
  },
  {
    area: 'platform', category: 'general', slug: 'api-principles', date: '2026-07-07', type: 'general',
    author: 'Amara Diallo', title: 'Principles for the public API',
    summary: 'Five rules every endpoint follows.',
    body: [
      '1. Predictable names: plural nouns, no verbs in paths.',
      '2. Errors always carry a code, a message and a hint.',
      '3. Lists are paginated from day one.',
      '4. Nothing breaks without a version bump and a notice.',
      '5. Every example in the documentation runs as written.',
    ],
  },
  {
    area: 'platform', category: 'notes', slug: 'audit-log-notes', date: '2026-09-15', type: 'note',
    author: 'Felix Moreau', title: 'Notes: what the audit log must record',
    summary: 'The minimum set of events for the first audit log release.',
    body: [
      '## Events', '',
      'Sign-in, key creation, key rotation, role change, order edit and data export.', '',
      '## Format', '',
      'Who, what, when, from where, and the before and after values where they exist.',
    ],
  },
];

// Meeting archive: eight notes, three with a transcript. Dates inside the quarter.
const MEETINGS = [
  {
    folder: '2026-07-15_sprint-21-review', date: '2026-07-15', title: 'Sprint 21 review', minutes: 52, transcript: true,
    category: 'review', folderId: 'reviews', people: ['Alex Morgan', 'Elena Rossi', 'Grace Whitfield', 'Hannah Weiss'],
    brief: 'The first review of the quarter. Atlas and Borealis showed finished work; Comet explained why the import slipped.',
    summary: [
      '## Summary', '',
      'Four squads presented. Order editing is in pilot with two accounts. Checkout now has three steps in a test environment.', '',
      '## Decisions', '',
      '- Comet moves the import demo to the next review.',
      '- Atlas starts the bulk import after the pilot.', '',
      '## Follow-ups', '',
      '- Grace to share the supplier file sizes before Friday.',
    ],
    lines: [
      ['Alex Morgan', 'We closed the order editing flow this sprint. Two pilot accounts are already using it.'],
      ['Elena Rossi', 'Checkout is down to three steps in the test environment. We still need the address memory.'],
      ['Grace Whitfield', 'The import did not make it. The largest supplier file is three times bigger than we planned for.'],
      ['Hannah Weiss', 'Then let us look at the file sizes together before the next sprint starts.'],
    ],
  },
  {
    folder: '2026-07-29_sprint-22-review', date: '2026-07-29', title: 'Sprint 22 review', minutes: 47, transcript: false,
    category: 'review', folderId: 'reviews', people: ['Alex Morgan', 'Zoe Carter', 'Amara Diallo'],
    brief: 'Echo and Falcon joined the review for the first time.',
    summary: ['## Summary', '', 'Echo showed typo tolerance, Falcon the first API keys.', '', '## Decisions', '', '- Public API keys are issued by hand until the audit log exists.'],
  },
  {
    folder: '2026-08-05_planning-sprint-24', date: '2026-08-05', title: 'Planning for sprint 24', minutes: 63, transcript: true,
    category: 'planning', folderId: 'planning', people: ['Sam Rivera', 'Jordan Lee', 'Taylor Kim', 'Dmitri Volkov'],
    brief: 'Capacity, holidays and the release scheduled for the first day of the sprint.',
    summary: [
      '## Summary', '',
      'Three people are away for a week each. The release on the first day of the sprint is the main risk.', '',
      '## Decisions', '',
      '- Keep the committed scope at 80 percent of the average.',
      '- One person per squad stays reachable on release day.',
    ],
    lines: [
      ['Sam Rivera', 'With two people on holiday I would commit to thirty points, not thirty-four.'],
      ['Jordan Lee', 'Checkout has the release on day one. I want a freeze on risky changes until it is out.'],
      ['Taylor Kim', 'Comet is fine with that. We will use the first days to fix import errors.'],
      ['Dmitri Volkov', 'Delta can take the carrier connector as the main goal, it does not touch the release.'],
    ],
  },
  {
    folder: '2026-08-19_retro-after-release', date: '2026-08-19', title: 'Retrospective after the August release', minutes: 58, transcript: true,
    category: 'retro', folderId: 'retros', people: ['Elena Rossi', 'Jordan Lee', 'Tomas Novak', 'Kofi Mensah', 'Nadia Petrova'],
    brief: 'What went wrong in the August release and what we change.',
    summary: [
      '## Summary', '',
      'The release introduced a rounding problem in order totals and a spike of support tickets in the following days.', '',
      '## What helped', '',
      '- The rollback plan was ready and used within an hour.', '',
      '## What we change', '',
      '- A checklist for price and total changes.', '- Test data with awkward prices in the shared test environment.',
    ],
    lines: [
      ['Elena Rossi', 'The rounding bug cost us two days of support time. Let us start with what we saw first.'],
      ['Tomas Novak', 'Our regression suite had no case with a price like nine ninety-nine times three.'],
      ['Kofi Mensah', 'I can add a set of awkward prices to the shared test data today.'],
      ['Jordan Lee', 'And a rule: any change to totals needs a second pair of eyes before the release.'],
      ['Nadia Petrova', 'Support asked for a banner when a known issue is open. That would have saved many tickets.'],
    ],
  },
  {
    folder: '2026-08-26_sprint-24-review', date: '2026-08-26', title: 'Sprint 24 review', minutes: 49, transcript: false,
    category: 'review', folderId: 'reviews', people: ['Alex Morgan', 'Elena Rossi', 'Hannah Weiss', 'Zoe Carter'],
    brief: 'A review dominated by the release fallout, with a good demo from Delta.',
    summary: ['## Summary', '', 'Delta demonstrated live tracking. Borealis reported the fixes after the release.', '', '## Decisions', '', '- Known issues get a banner in the app.'],
  },
  {
    folder: '2026-09-02_roadmap-check-in', date: '2026-09-02', title: 'Roadmap check-in', minutes: 40, transcript: false,
    category: 'planning', folderId: 'planning', people: ['Alex Morgan', 'Grace Whitfield', 'Amara Diallo'],
    brief: 'Which initiatives are slipping and what we do about it.',
    summary: ['## Summary', '', 'Two initiatives are behind: the catalog import and the public API.', '', '## Decisions', '', '- Catalog import gets one more person for two sprints.', '- Public API v2 moves its go-live by three weeks.'],
  },
  {
    folder: '2026-09-09_sprint-26-planning', date: '2026-09-09', title: 'Planning for sprint 26', minutes: 55, transcript: false,
    category: 'planning', folderId: 'planning', people: ['Sam Rivera', 'Samir Haddad', 'Ingrid Solberg', 'Oscar Lindqvist', 'Rafael Costa', 'Felix Moreau'],
    brief: 'The last sprint of the quarter: what we finish and what we leave for later.',
    summary: ['## Summary', '', 'Everybody commits to a little less than usual to leave room for the quarter review.', '', '## Decisions', '', '- No new epics are started in this sprint.'],
  },
  {
    folder: '2026-09-23_quarter-review', date: '2026-09-23', title: 'Quarter review', minutes: 75, transcript: false,
    category: 'review', folderId: 'reviews', people: ['Alex Morgan', 'Elena Rossi', 'Grace Whitfield', 'Hannah Weiss', 'Zoe Carter', 'Amara Diallo'],
    brief: 'Six squads, one quarter: what shipped, what slipped and what we learned.',
    summary: [
      '## Summary', '',
      'Order editing, checkout and delivery tracking shipped. The catalog import and the public API are late but moving.', '',
      '## Numbers', '',
      '- Average sprint completion: 87 percent.', '- Production bugs open at the end of the quarter: 24.', '',
      '## Next quarter', '',
      '- Finish the import and the API.', '- Start the customer portal for returns.',
    ],
    html: true,
  },
];

const MEETING_CATEGORIES = [
  { id: 'review', name: 'Reviews' },
  { id: 'planning', name: 'Planning' },
  { id: 'retro', name: 'Retrospectives' },
];

const MEETING_FOLDERS = [
  { id: 'reviews', name: 'Reviews', parent_id: null, order: 1 },
  { id: 'planning', name: 'Planning', parent_id: null, order: 2 },
  { id: 'retros', name: 'Retrospectives', parent_id: null, order: 3 },
];

// Responsibilities (RAG per area and month). Ten areas in three groups.
const RESPONSIBILITY_GROUPS = [
  {
    name: 'Product', areas: [
      ['Roadmap and priorities', 'Decides what is built next and says no to the rest.', 'Alex Morgan'],
      ['Customer feedback', 'Collects, groups and shares what customers tell us.', 'Zoe Carter'],
      ['Pricing and packaging', 'Owns plans, limits and what each plan includes.', 'Amara Diallo'],
    ],
  },
  {
    name: 'Delivery', areas: [
      ['Release management', 'Plans releases, freezes and rollbacks.', 'Elena Rossi'],
      ['Quality and testing', 'Keeps the regression suite useful and fast.', 'Tomas Novak'],
      ['Incident response', 'On-call, status updates and the post-incident review.', 'Dmitri Volkov'],
      ['Documentation', 'Keeps guides, API docs and release notes current.', 'Felix Moreau'],
    ],
  },
  {
    name: 'Operations', areas: [
      ['Vendor management', 'Contracts, purchase orders and monthly settlements.', 'Hannah Weiss'],
      ['Data and reporting', 'Dashboards, definitions and the weekly numbers.', 'Grace Whitfield'],
      ['Onboarding', 'First two weeks of every new colleague.', 'Samir Haddad'],
    ],
  },
];

// Onboarding: a two-week plan for a new colleague.
const ONBOARDING_LINKS = [
  ['Team handbook', 'https://wiki.example.com/northwind/handbook', 'How we work, in ten pages.'],
  ['Product tour', 'https://wiki.example.com/northwind/product-tour', 'A guided walk through the product.'],
  ['Architecture overview', 'https://wiki.example.com/northwind/architecture', 'The big picture of the system.'],
  ['Support playbook', 'https://wiki.example.com/northwind/support', 'How to answer the most common questions.'],
  ['Sprint review calendar', 'view://sprint-review-main', 'Open the sprint review in Mission Deck.'],
];

const ONBOARDING_ROWS = [
  ['Welcome and setup', 'Laptop, accounts, and a first coffee with the squad.', 'Squad lead', 'Day 1'],
  ['Read the handbook', 'Ten pages, with questions written down.', 'New colleague', 'Day 1'],
  ['Product tour', 'Use the product as a customer for an hour.', 'Product owner', 'Day 2'],
  ['Meet the other squads', 'Fifteen minutes with one person from each squad.', 'New colleague', 'Day 2 to 3'],
  ['First small task', 'A change small enough to ship by Friday.', 'Buddy', 'Day 3 to 5'],
  ['Shadow a support call', 'Listen to how customers talk about the product.', 'Support', 'Day 4'],
  ['Sprint planning', 'Join planning and ask about anything unclear.', 'Squad', 'Day 6'],
  ['Review the first task', 'Show the result at the sprint review.', 'New colleague', 'Day 9'],
  ['Retrospective on onboarding', 'What helped, what was missing.', 'Squad lead', 'Day 10'],
];

// Vendors (fictional) with invoices.
const VENDORS = [
  {
    name: 'Acme Ltd', full_name: 'Acme Ltd Consulting Services', address: '1 Example Road, Exampleton',
    tax_id: '000-111-22-33', registry_no: '0000123456', squad: 'atlas', person: 'Wei Zhang',
    poName: 'Order editing support', po: 'PO-2026-014', poAmount: 90000, rate: 520, mail: 'wei.zhang',
  },
  {
    name: 'Globex', full_name: 'Globex Corporation', address: '22 Sample Street, Sampleville',
    tax_id: '000-222-33-44', registry_no: '0000234567', squad: 'borealis', person: 'Marta Kowal',
    poName: 'Checkout optimisation', po: 'PO-2026-021', poAmount: 72000, rate: 480, mail: 'marta.kowal',
  },
  {
    name: 'Initech', full_name: 'Initech Software Ltd', address: '7 Placeholder Avenue, Placeholder City',
    tax_id: '000-333-44-55', registry_no: '0000345678', squad: 'comet', person: 'Ben Hartley',
    poName: 'Catalog import development', po: 'PO-2026-027', poAmount: 108000, rate: 560, mail: 'ben.hartley',
  },
];

const LOCATION_REGIONS = [
  { name: 'North', prefix: 'NOR', cities: ['Harbourton', 'Northfield', 'Pinebridge', 'Coldwater', 'Elmstead'] },
  { name: 'South', prefix: 'SOU', cities: ['Southgate', 'Sunhaven', 'Olivecross', 'Redmoor', 'Fairwick'] },
  { name: 'East', prefix: 'EAS', cities: ['Eastbourne Park', 'Dawnmere', 'Stonebridge', 'Kingsmead', 'Larkfield'] },
  { name: 'West', prefix: 'WES', cities: ['Westvale', 'Ravenhill', 'Millford', 'Oakhurst', 'Seabrook'] },
  { name: 'Central', prefix: 'CEN', cities: ['Midtown', 'Crossways', 'Marketon', 'Riverside', 'Highfield'] },
  { name: 'Islands', prefix: 'ISL', cities: ['Port Aster', 'Gullrock', 'Bayhaven', 'Skerry Point', 'Lowtide'] },
];

const SITE_MANAGERS = [
  'Nina Adler', 'Peter Okonkwo', 'Lucia Ferrari', 'Hugo Becker', 'Mei Lin', 'Carl Jensen',
  'Rosa Delgado', 'Omar Nasser', 'Ida Lund', 'Victor Arnaud', 'Tess Walker', 'Jun Park',
];

module.exports = {
  DOMAIN, SQUADS, ISSUE_TITLES, BUG_TITLES, REVIEW_TOPICS, INITIATIVES, DOCS, MEETINGS,
  MEETING_CATEGORIES, MEETING_FOLDERS, RESPONSIBILITY_GROUPS, ONBOARDING_LINKS, ONBOARDING_ROWS,
  VENDORS, LOCATION_REGIONS, SITE_MANAGERS,
};
