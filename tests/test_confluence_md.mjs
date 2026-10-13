// tests/test_confluence_md.mjs
// Confluence HTML -> Markdown conversion, page-id extraction, and the agent
// frontmatter parser. All pure functions; no network, no server.

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srv = require('../server.js');

test('_extractConfluencePageId accepts an id, a /pages/ URL and a ?pageId= URL', () => {
  assert.strictEqual(srv._extractConfluencePageId('123456'), '123456');
  assert.strictEqual(srv._extractConfluencePageId('https://kb.example/display/X/pages/987654/Title'), '987654');
  assert.strictEqual(srv._extractConfluencePageId('https://kb.example/pages/viewpage.action?pageId=42'), '42');
  assert.strictEqual(srv._extractConfluencePageId(''), '');
});

test('_stripHtmlTags removes markup and decodes the basic entities', () => {
  assert.strictEqual(srv._stripHtmlTags('<b>a</b> &amp; <i>b</i>'), 'a & b');
  assert.strictEqual(srv._stripHtmlTags('&lt;tag&gt; &quot;q&quot; &#39;s&#39;'), '<tag> "q" \'s\'');
  assert.strictEqual(srv._stripHtmlTags(''), '');
});

test('_inlineHtmlToMd converts links, emphasis and inline code', () => {
  assert.strictEqual(srv._inlineHtmlToMd('<a href="https://x/y">click</a>'), '[click](https://x/y)');
  // A link with no text degrades to the bare URL rather than an empty label.
  assert.strictEqual(srv._inlineHtmlToMd('<a href="https://x/y"></a>'), 'https://x/y');
  assert.strictEqual(srv._inlineHtmlToMd('<strong>bold</strong>'), '**bold**');
  assert.strictEqual(srv._inlineHtmlToMd('<em>it</em>'), '_it_');
  assert.strictEqual(srv._inlineHtmlToMd('<code>x()</code>'), '`x()`');
});

test('_confluenceHtmlToMd renders headings, lists, code and tables', () => {
  const md = srv._confluenceHtmlToMd([
    '<h2>Tytul</h2>',
    '<p>Akapit z <strong>pogrubieniem</strong>.</p>',
    '<ul><li>raz</li><li>dwa</li></ul>',
    '<ol><li>pierwszy</li><li>drugi</li></ol>',
    '<pre>const x = 1;</pre>',
    '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
  ].join(''));

  assert.match(md, /^## Tytul$/m);
  assert.match(md, /Akapit z \*\*pogrubieniem\*\*\./);
  assert.match(md, /^- raz$/m);
  assert.match(md, /^2\. drugi$/m);
  assert.match(md, /```\nconst x = 1;\n```/);
  assert.match(md, /^\| A \| B \|$/m);
  assert.match(md, /^\| --- \| --- \|$/m);
  assert.match(md, /^\| 1 \| 2 \|$/m);
  // Never more than one blank line in a row, and always exactly one trailing newline.
  assert.ok(!/\n{3,}/.test(md));
  assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
});

test('_confluenceHtmlToMd drops CDATA, the ToC and non-attachment images', () => {
  const md = srv._confluenceHtmlToMd([
    '<style><![CDATA[ .x { color: red } ]]></style>',
    '<p><a href="#id-Spis">Spis</a></p>',
    '<img src="https://cdn.example/icon.png">',
    '<img src="https://kb.example/download/attachments/12/diagram%20final.png">',
    '<p>tresc</p>',
  ].join(''));

  assert.ok(!md.includes('color: red'));
  assert.ok(!md.includes('#id-Spis'));
  assert.ok(!md.includes('icon.png'));
  // Attachment filenames are percent-decoded so the marker stays readable.
  assert.match(md, /\[image: diagram final\.png\]/);
  assert.match(md, /tresc/);
});

test('_confluenceHtmlToMd handles empty input', () => {
  assert.strictEqual(srv._confluenceHtmlToMd(''), '');
  assert.strictEqual(srv._confluenceHtmlToMd(null), '');
});

test('_confluenceEscapeXml escapes every storage-format metacharacter', () => {
  assert.strictEqual(srv._confluenceEscapeXml('<a & "b" \'c\'>'), '&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;');
});

test('_parseAgentFrontmatter reads scalars and folded descriptions', () => {
  const inline = srv._parseAgentFrontmatter([
    '---',
    'name: bug-auditor',
    'description: Finds bugs.',
    'model: claude-sonnet-4-6',
    '---',
    '# Body that must be ignored',
    'model: not-this-one',
  ].join('\n'));
  assert.strictEqual(inline.name, 'bug-auditor');
  assert.strictEqual(inline.description, 'Finds bugs.');
  assert.strictEqual(inline.model, 'claude-sonnet-4-6');
  assert.strictEqual(inline.modelFallbacks, null);

  // A folded block scalar: '>' is a marker, the value is the next line.
  const folded = srv._parseAgentFrontmatter([
    '---',
    'name: idea-planner',
    'description: >-',
    '  Plans an idea end to end.',
    '  Continuation that is not captured.',
    'model: claude-opus-5',
    '---',
  ].join('\n'));
  assert.strictEqual(folded.description, 'Plans an idea end to end.');
  assert.strictEqual(folded.model, 'claude-opus-5');
});

test('_parseAgentFrontmatter returns nulls without a frontmatter block', () => {
  const r = srv._parseAgentFrontmatter('no frontmatter here\nmodel: nope\n');
  assert.deepStrictEqual(r, { name: null, description: null, model: null, modelFallbacks: null });
});

test('every agent shipped in .claude/agents uses an allowlisted model', () => {
  for (const agent of srv._listAgents()) {
    if (!agent.model) continue;
    assert.ok(
      srv.AGENT_MODEL_ALLOWLIST.includes(agent.model),
      `agent ${agent.name} uses ${agent.model}, which is not in AGENT_MODEL_ALLOWLIST`,
    );
  }
});
