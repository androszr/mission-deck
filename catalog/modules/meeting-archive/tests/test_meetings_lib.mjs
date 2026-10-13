import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../server/meetings-lib.js');

const FENCE = '```';

test('extractSummaryMd: fenced valid, fenced with literal newline, bare, plain', () => {
  const valid = FENCE + 'json\n' + JSON.stringify({ chosen_template: 'x', summary_md: '# A\n\nb' }) + '\n' + FENCE;
  assert.strictEqual(lib.extractSummaryMd(valid), '# A\n\nb');
  const broken = FENCE + 'json\n{ "chosen_template": "x",\n "summary_md": "# T\nline \\"q\\"\\n\\nend"\n}\n' + FENCE;
  assert.strictEqual(lib.extractSummaryMd(broken), '# T\nline "q"\n\nend');
  assert.strictEqual(lib.extractSummaryMd('{"summary_md":"# Bare"}'), '# Bare');
  assert.strictEqual(lib.extractSummaryMd('# Plain\n\ntext'), '# Plain\n\ntext');
  assert.strictEqual(lib.extractSummaryMd(''), '');
});

test('parseBriefMeta: fenced title+brief and plain prose', () => {
  const raw = FENCE + 'json\n{"title":"Title","brief":"Meeting description"}\n' + FENCE;
  assert.deepStrictEqual(lib.parseBriefMeta(raw), { title: 'Title', brief: 'Meeting description' });
  assert.deepStrictEqual(lib.parseBriefMeta('Plain description'), { title: '', brief: 'Plain description' });
});

test('resolveTitle and resolveDate follow the precedence', () => {
  const brief = FENCE + 'json\n{"title":"From brief","brief":"b"}\n' + FENCE;
  const folder = '2026-06-10_23-33_poc-recording';
  assert.strictEqual(lib.resolveTitle({ userMeta: { custom_title: 'U' }, metadata: { custom_title: 'M' }, info: { title: 'I' }, folder }), 'U');
  assert.strictEqual(lib.resolveTitle({ metadata: { custom_title: 'M' }, info: { title: 'I' }, folder }), 'M');
  assert.strictEqual(lib.resolveTitle({ info: { title: 'I' }, folder }), 'I');
  assert.strictEqual(lib.resolveTitle({ info: { title: '', brief }, folder }), 'From brief');
  assert.strictEqual(lib.resolveTitle({ info: { title: '' }, folder }), 'poc recording');
  assert.strictEqual(lib.resolveDate({ userMeta: { meeting_date: '2026-01-02' }, folder }), '2026-01-02');
  assert.strictEqual(lib.resolveDate({ metadata: { meeting_date: '2026-02-03' }, folder }), '2026-02-03');
  assert.strictEqual(lib.resolveDate({ folder }), '2026-06-10');
  assert.strictEqual(lib.resolveDate({ folder: 'manual-2026-06-11_22-33-12' }), '2026-06-11');
  assert.strictEqual(lib.resolveDate({ folder: 'zzz', metadata: { processed_at: '2026-03-04T10:00:00Z' } }), '2026-03-04');
});

test('buildListItem: error only for the literal status, isManual from is_manual', () => {
  const base = { folder: 'manual-2026-06-11_22-33-12', info: { title: 'T', participants: [{ name: 'Sam', member_id: 'tm-1' }] }, userMeta: { categories: ['c1'], virtual_folder_id: 'f1' }, dir: '' };
  const blad = lib.buildListItem({ ...base, metadata: { status: 'error', errorReason: 'broken' } });
  assert.strictEqual(blad.status, 'error');
  assert.strictEqual(blad.errorReason, 'broken');
  const pending = lib.buildListItem({ ...base, metadata: { status: 'pending', is_manual: true } });
  assert.strictEqual(pending.status, 'ok');
  assert.strictEqual(pending.isManual, true);
  assert.deepStrictEqual(pending.participants, [{ name: 'Sam', memberId: 'tm-1' }]);
  assert.deepStrictEqual(pending.categoryIds, ['c1']);
  assert.strictEqual(pending.folderId, 'f1');
});

test('logo placeholder: extract from template and fill', () => {
  const tpl = '<img src="data:image/png;base64,AAAA+/==" alt="">';
  const uri = lib.extractLogoDataUri(tpl);
  assert.strictEqual(uri, 'data:image/png;base64,AAAA+/==');
  assert.strictEqual(lib.extractLogoDataUri('<p>none</p>'), '');
  const html = '<img class="logo" src="__REPORT_LOGO_SRC__"><img src="__REPORT_LOGO_SRC__">';
  assert.strictEqual(lib.fillLogoPlaceholder(html, uri), '<img class="logo" src="' + uri + '"><img src="' + uri + '">');
  assert.strictEqual(lib.fillLogoPlaceholder(html, ''), html);
  assert.strictEqual(lib.fillLogoPlaceholder('<p>x</p>', uri), '<p>x</p>');
});
