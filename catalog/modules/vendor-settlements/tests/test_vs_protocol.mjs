// vendor-settlements/tests/test_vs_protocol.mjs
// The protocol generator: validation, deps gate, names, print page, and a
// real .docx when the optional libraries are installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { setup } from './fixtures/harness.mjs';

const require = createRequire(import.meta.url);
const protocol = require('../server/protocol-docx.js');

let docx = null;
let mammoth = null;
try { docx = require('docx'); } catch { /* generator tests below skip */ }
try { mammoth = require('mammoth'); } catch { /* ditto */ }

const BODY = {
  company: 'Acme Ltd', month: '2026-09', protocol_number: 'PROT/9', protocol_date: '2026-09-30',
  po_name: 'Framework agreement', po_number: 'PO-1', vendor: { full_name: 'Acme Ltd', address: '1 Example Street', tax_id: '0000000000' },
  persons: [{ name: 'Alex Morgan', hours: 80, md: 10, daily_rate: 800, amount: 8000 }, { name: 'Sam Rivera', hours: 8, md: 1, daily_rate: 800, amount: 800 }],
};

test('generate validation: missing fields, bad month, empty persons -> 400', async (t) => {
  const { call } = setup(t);
  for (const b of [{ ...BODY, company: '' }, { ...BODY, month: '2026/09' }, { ...BODY, persons: [] }]) {
    const r = await call('POST', '/protocols/generate', b, '?project=atlas');
    assert.equal(r.status, 400);
  }
  assert.equal((await call('POST', '/protocols/generate', BODY, '?project=nowhere')).status, 400);
});

test('generate answers 503 deps-missing when the docx handle is null', async (t) => {
  const { call } = setup(t);
  const r = await call('POST', '/protocols/generate', BODY, '?project=atlas');
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'deps-missing');
});

test('person names: a unique match gives the directory name, an ambiguous one the affix strip', () => {
  const out = protocol.resolveProtocolPersonNames(
    [{ name: 'ACM Morgan Alex' }, { name: 'ACM Lee Jordan [X]' }],
    ['Alex Morgan', 'Jordan Lee', 'Lee Jordan'],
  );
  assert.deepEqual(out.map((p) => p.name), ['Alex Morgan', 'Lee Jordan']);
});

test('customer lines come from configuration with neutral defaults', () => {
  assert.deepEqual(protocol.customerLines({}), ['Example Customer Ltd', '1 Example Street', '00-000 Springfield', 'Tax ID: 0000000000']);
  assert.deepEqual(protocol.customerLines({ SETTLEMENTS_CUSTOMER_NAME: 'Initech', SETTLEMENTS_CUSTOMER_ADDRESS: 'A|B', SETTLEMENTS_CUSTOMER_TAX_ID: '1' }),
    ['Initech', 'A', 'B', 'Tax ID: 1']);
});

test('the print page keeps its colours in custom properties, has no inline script and escapes the title', () => {
  const page = protocol.buildPrintPage('<p>x</p>', 'A<B>.pdf');
  assert.match(page, /--prot-head-bg: #4F81BD/);
  assert.match(page, /<title>A&lt;B&gt;\.pdf<\/title>/);
  assert.equal(/<script/i.test(page), false);
});

function zipEntry(buf, name) {
  let i = 0;
  while ((i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), i)) !== -1) {
    const method = buf.readUInt16LE(i + 8);
    const csize = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const xlen = buf.readUInt16LE(i + 28);
    const fname = buf.toString('utf8', i + 30, i + 30 + nlen);
    const start = i + 30 + nlen + xlen;
    if (fname === name) {
      const raw = buf.subarray(start, start + csize);
      return method === 0 ? raw : zlib.inflateRawSync(raw);
    }
    i = start;
  }
  return null;
}

test('generate builds a real .docx naming every person and the total', { skip: !docx }, async (t) => {
  const { call } = setup(t, { deps: { docx, mammoth, readMembers: () => ['Alex Morgan', 'Sam Rivera'] } });
  const r = await call('POST', '/protocols/generate', { ...BODY, persons: BODY.persons.map((p) => ({ ...p, name: p.name === 'Alex Morgan' ? 'ACM Morgan Alex' : p.name })) }, '?project=atlas');
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Disposition'], 'attachment; filename="ACMELTD-protocol-2026-09.docx"');
  const xml = zipEntry(r.raw, 'word/document.xml').toString('utf8');
  assert.ok(xml.includes('Alex Morgan') && xml.includes('Sam Rivera'));
  assert.ok(xml.includes('ACCEPTANCE PROTOCOL'));
  assert.ok(xml.includes('8,800 + VAT'));
});

test('generate?format=pdf answers the print page built from mammoth', { skip: !docx || !mammoth }, async (t) => {
  const { call } = setup(t, { deps: { docx, mammoth } });
  const r = await call('POST', '/protocols/generate', BODY, '?format=pdf&project=atlas');
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /text\/html/);
  assert.match(r.raw.toString('utf8'), /Alex Morgan/);
});
