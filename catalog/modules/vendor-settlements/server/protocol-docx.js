'use strict';
// vendor-settlements/server/protocol-docx.js
// The acceptance protocol as a .docx, plus the print page around its HTML.
// The docx library handle is injected (the module requires it lazily, see
// index.js), so this file loads and is testable without node_modules.

// The customer block of the protocol (the party that accepts the work).
// Configuration, never code: SETTLEMENTS_CUSTOMER_NAME, SETTLEMENTS_CUSTOMER_ADDRESS
// (lines separated by "|") and SETTLEMENTS_CUSTOMER_TAX_ID.
function customerLines(env) {
  const e = env || {};
  const name = e.SETTLEMENTS_CUSTOMER_NAME || 'Example Customer Ltd';
  const address = String(e.SETTLEMENTS_CUSTOMER_ADDRESS || '1 Example Street|00-000 Springfield')
    .split('|').map((s) => s.trim()).filter(Boolean);
  const taxId = e.SETTLEMENTS_CUSTOMER_TAX_ID || '0000000000';
  return [name, ...address, 'Tax ID: ' + taxId];
}

// Build a .docx buffer from the protocol payload.
// payload: { vendor, company, customer[], po_name, po_number, month (YYYY-MM), month_label,
//            protocol_number, protocol_date, persons[], total_amount }
// Each person: { name, hours, md, daily_rate, amount }
function buildProtocolDocx(payload, docx) {
  if (!docx) {
    const e = new Error('docx-missing');
    e.code = 'deps-missing';
    throw e;
  }
  const {
    Document, Paragraph, Table, TableRow, TableCell, TextRun,
    AlignmentType, WidthType, BorderStyle, Packer,
  } = docx;

  const SZ = 20; // 10pt

  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[1]}-${m[2]}-${m[3]}` : (iso || '');
  }

  function monthPeriod(ym) {
    const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
    if (!m) return ym || '';
    const last = new Date(parseInt(m[1]), parseInt(m[2]), 0).getDate();
    const mm = m[2];
    const dd = String(last).padStart(2, '0');
    return `${m[1]}-${mm}-01 to ${m[1]}-${mm}-${dd}`;
  }

  function fmtAmount(n) {
    const v = Number(n || 0);
    const s = v % 1 === 0
      ? v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${s} + VAT`;
  }

  function fmtHours(n) {
    const v = Number(n || 0);
    return v % 1 === 0 ? String(v) : v.toFixed(2);
  }

  function fmtHourlyRate(dailyRate) {
    const h = Number(dailyRate || 0) / 8;
    return (h % 1 === 0 ? String(Math.round(h)) : h.toFixed(2)) + '/h';
  }

  // Borders
  const solidBorder = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const tblBorder = { top: solidBorder, bottom: solidBorder, left: solidBorder, right: solidBorder };
  const noBorder = { style: BorderStyle.NIL, size: 0, color: 'auto' };
  const noTblBorder = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
  const noTblBorderFull = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder };

  function run(text, bold) { return new TextRun({ text: String(text), bold: !!bold, size: SZ }); }
  function emptyPara() { return new Paragraph({ children: [run('')] }); }

  // ── Party table (2-col, no borders, mirroring reference) ──────────────
  const vendor = payload.vendor || {};
  const vendorLines = [
    vendor.full_name || payload.company || '',
    vendor.address || '',
    vendor.tax_id ? `Tax ID: ${vendor.tax_id}` : '',
    vendor.registry_no ? `Registry no.: ${vendor.registry_no}` : '',
  ].filter(Boolean);

  const customer = Array.isArray(payload.customer) && payload.customer.length ? payload.customer : customerLines({});

  function partyCell(header, lines, indentLeft) {
    const indent = indentLeft ? { left: indentLeft } : undefined;
    return new TableCell({
      borders: noTblBorder,
      width: { size: 4673, type: WidthType.DXA },
      children: [
        new Paragraph({ children: [run(header, true)], indent }),
        ...lines.map(l => new Paragraph({ children: [run(l)], indent })),
        emptyPara(),
      ],
    });
  }

  const partyTable = new Table({
    width: { size: 9346, type: WidthType.DXA },
    borders: noTblBorderFull,
    rows: [new TableRow({
      children: [
        partyCell('CONTRACTOR:', vendorLines),
        partyCell('CUSTOMER:', customer, 2019),
      ],
    })],
  });

  // ── Persons table (5-col, solid borders, mirroring reference) ────────
  // Col widths: Project=3114 | Time(h)=1417 | Time(MD)=1701 | Rate=1985 | Amount=2239
  const COLS = [3114, 1417, 1701, 1985, 2239];

  function tblHdr(text, colIdx) {
    return new TableCell({
      borders: tblBorder,
      width: { size: COLS[colIdx], type: WidthType.DXA },
      children: [new Paragraph({ children: [run(text, true)] })],
    });
  }

  function tblCell(text, colIdx, align) {
    return new TableCell({
      borders: tblBorder,
      width: { size: COLS[colIdx], type: WidthType.DXA },
      children: [new Paragraph({ children: [run(text)], alignment: align })],
    });
  }

  function tblProjectCell(person) {
    return new TableCell({
      borders: tblBorder,
      width: { size: COLS[0], type: WidthType.DXA },
      children: [new Paragraph({
        children: [
          run(person.name || ''),
          new TextRun({ text: `${payload.po_name || ''}`, size: SZ, break: 1 }),
          new TextRun({ text: `PO: ${payload.po_number || ''}`, size: SZ, break: 1 }),
        ],
      })],
    });
  }

  const personsTableRows = [
    new TableRow({
      tableHeader: true,
      children: [
        tblHdr('Project', 0),
        tblHdr('Time (h)', 1),
        tblHdr('Time (MD)', 2),
        tblHdr('Rate', 3),
        tblHdr('Amount', 4),
      ],
    }),
    ...(payload.persons || []).map(p => new TableRow({
      children: [
        tblProjectCell(p),
        tblCell(fmtHours(p.hours), 1, AlignmentType.RIGHT),
        tblCell(Number(p.md || 0).toFixed(2), 2, AlignmentType.RIGHT),
        tblCell(fmtHourlyRate(p.daily_rate), 3, AlignmentType.RIGHT),
        tblCell(fmtAmount(p.amount), 4, AlignmentType.RIGHT),
      ],
    })),
    new TableRow({
      children: [
        new TableCell({
          borders: tblBorder,
          columnSpan: 4,
          width: { size: COLS[0] + COLS[1] + COLS[2] + COLS[3], type: WidthType.DXA },
          children: [new Paragraph({ children: [run('TOTAL', true)], alignment: AlignmentType.RIGHT })],
        }),
        new TableCell({
          borders: tblBorder,
          width: { size: COLS[4], type: WidthType.DXA },
          children: [new Paragraph({ children: [run(fmtAmount(payload.total_amount))] })],
        }),
      ],
    }),
  ];

  const personsTable = new Table({
    width: { size: 9346, type: WidthType.DXA },
    rows: personsTableRows,
  });

  // ── Signature table (2-col, no borders, centered) ────────────────────
  function sigCell(label) {
    return new TableCell({
      borders: noTblBorder,
      width: { size: 4673, type: WidthType.DXA },
      children: [new Paragraph({
        children: [
          run(label, true),
          new TextRun({ text: '', size: SZ, break: 1 }),
          new TextRun({ text: '', size: SZ, break: 1 }),
          new TextRun({ text: '……………………….', bold: true, size: SZ, break: 1 }),
        ],
        alignment: AlignmentType.CENTER,
      })],
    });
  }

  const sigTable = new Table({
    width: { size: 9346, type: WidthType.DXA },
    borders: noTblBorderFull,
    rows: [new TableRow({
      children: [
        sigCell('CONTRACTOR SIGNATURE'),
        sigCell('CUSTOMER SIGNATURE'),
      ],
    })],
  });

  const doc = new Document({
    sections: [{
      children: [
        // 1. Header: "ACCEPTANCE PROTOCOL / dated YYYY-MM-DD" - centered
        new Paragraph({
          children: [
            run('ACCEPTANCE PROTOCOL', true),
            new TextRun({ text: `dated ${fmtDate(payload.protocol_date)}`, size: SZ, bold: true, break: 1 }),
          ],
          alignment: AlignmentType.CENTER,
        }),
        emptyPara(),

        // 2. Party table (CONTRACTOR | CUSTOMER side by side, no borders)
        partyTable,
        emptyPara(),

        // 3. SUBJECT OF THE ORDER (bold heading + description with period range)
        new Paragraph({ children: [run('SUBJECT OF THE ORDER', true)] }),
        new Paragraph({
          children: [run(
            `Time and materials software development for ${payload.po_name || ''} ` +
            `for the period ${monthPeriod(payload.month)}`
          )],
        }),
        emptyPara(),

        // 4. ORDER SUMMARY (bold heading + closing statement)
        new Paragraph({ children: [run('ORDER SUMMARY', true)] }),
        new Paragraph({
          children: [run(
            'This protocol, together with the previously accepted timesheet, is the basis ' +
            'for issuing the invoice and confirms the transfer of rights to the delivered work.'
          )],
        }),
        emptyPara(),

        // 5. Persons table
        personsTable,
        emptyPara(),
        emptyPara(),
        emptyPara(),

        // 6. Confirmation sections
        new Paragraph({
          children: [
            run('* ', true),
            run('1. I CONFIRM THE ORDER WAS DELIVERED CORRECTLY AND ON TIME', true),
          ],
          spacing: { line: 240, lineRule: 'auto' },
        }),
        new Paragraph({
          children: [run('(to be completed only when the order was delivered without reservations)', true)],
          spacing: { line: 240, lineRule: 'auto' },
        }),
        emptyPara(),
        emptyPara(),
        new Paragraph({
          children: [
            run('* * ', true),
            run('2. IF ANY SHORTCOMINGS IN THE DELIVERY WERE FOUND, PLEASE LIST THEM', true),
          ],
        }),
        emptyPara(),
        emptyPara(),
        new Paragraph({
          children: [run('REMARKS:', true)],
          indent: { left: 708 },
        }),
        new Paragraph({
          children: [run('a) ..............................................................................................................')],
          indent: { left: 708 },
        }),
        new Paragraph({
          children: [run('b) ..............................................................................................................')],
          indent: { left: 708 },
        }),
        new Paragraph({
          children: [run('c) ..............................................................................................................')],
          indent: { left: 708 },
        }),
        emptyPara(),
        emptyPara(),
        emptyPara(),

        // 7. Signature table
        sigTable,
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

// -- Person display names ---------------------------------------------------
// Costs data carries the tracker display name verbatim ("ACM Morgan Alex"):
// vendor code prefix, surname first, sometimes without diacritics. The
// protocol leaves the company, so it must carry the real name. Per person:
// 1) unique token match against the team member names -> canonical
// "First Last", 2) fallback: strip leading vendor codes, a trailing "CTR" and
// the trailing "[X]" marker.

function protAsciiFold(s) {
  // The stroked L has no combining-mark form, so NFD leaves it intact.
  return String(s || '')
    .replace(/[\u0141\u0142]/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function protNameTokens(s) {
  return new Set(
    protAsciiFold(s).replace(/[^\w\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 2)
  );
}

function protStripNameAffixes(raw) {
  let out = String(raw || '').trim();
  out = out.replace(/\s*\[[^\]]*\]\s*$/, '');
  out = out.replace(/\s+CTR$/, '');
  while (/^[A-Z0-9]{2,4}\s+\S/.test(out)) out = out.replace(/^[A-Z0-9]{2,4}\s+/, '');
  return out.trim();
}

/**
 * Returns a copy of persons[] with `name` replaced by its display form.
 * `memberNames` is a list of canonical names (strings). An ambiguous match (more
 * than one member) falls back to the affix strip, so the document never silently
 * names the wrong person.
 */
function resolveProtocolPersonNames(persons, memberNames) {
  const members = (memberNames || [])
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter(Boolean)
    .map((name) => ({ name, tokens: protNameTokens(name) }))
    .filter((m) => m.tokens.size > 0);
  return (persons || []).map((p) => {
    const raw = String((p && p.name) || '');
    if (!raw) return p;
    const pt = protNameTokens(raw);
    let matches = [];
    if (pt.size > 0) {
      matches = members.filter((m) => {
        const mt = [...m.tokens];
        return mt.every((t) => pt.has(t)) || [...pt].every((t) => m.tokens.has(t));
      });
    }
    const display = matches.length === 1 ? matches[0].name : protStripNameAffixes(raw);
    return display && display !== raw ? { ...p, name: display } : p;
  });
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The print page around mammoth's HTML. A printed document, not a DS surface: its
 * three colours are custom properties declared at the top of its own style block.
 * Returns an HTML string.
 */
function buildPrintPage(html, filename) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(filename)}</title>
<style>
  :root { --prot-text: #111; --prot-head-bg: #4F81BD; --prot-head-fg: #fff; }
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; max-width: 820px; margin: 40px auto; padding: 0 32px; color: var(--prot-text); }
  h1 { font-size: 14pt; text-align: center; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; }
  td, th { border: 1px solid #000; padding: 5px 8px; }
  th { background: var(--prot-head-bg); color: var(--prot-head-fg); text-align: center; }
  p { margin: 3px 0; line-height: 1.4; }
  @media print { body { margin: 0; padding: 10mm 15mm; } }
  @page { margin: 0 15mm; }
</style>
</head>
<body>
${html}
</body>
</html>`;
}

module.exports = {
  buildProtocolDocx, resolveProtocolPersonNames, buildPrintPage, customerLines,
  protAsciiFold, protNameTokens, protStripNameAffixes,
};
