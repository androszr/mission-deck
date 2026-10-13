# Vendor settlements

Mission Deck module `vendor-settlements` (Finance hub): file vendor
settlements against purchase orders, compare worklog costs with what was
accepted, keep the list of settlements and generate an acceptance protocol
(.docx or a print page).

## View

| View id | Label |
|---|---|
| `vendor-settlements-main` | Vendor settlements |

- **Costs vs accepted** - per area and month, one pair of bars per vendor:
  worklog costs of the vendor's people against the amounts accepted through
  protocols.
- **Vendor settlement form** - area, period, vendor, aggregation mode (epics,
  people or a custom amount), the items, the purchase order and an optional
  protocol link. The order picker shows what is still available on each
  order (order amount minus what was settled and assigned) and warns about
  an overrun.
- **Settlements list** with search and area / vendor / month filters; each row
  can be previewed, marked as accepted, copied, edited or deleted.
- **Protocol generator** - a three-step wizard (settlement -> vendor details ->
  people) that ends in a .docx download or a print page.

## Data (`vendor-settlements/` in `data-tier-0`)

| File | Written by | Shape |
|---|---|---|
| `summary.json` | this module | `{ meta, assignments: [{ id, area, title, period_from, period_to, vendor, mode, items, amount, amount_full, po_number, po_name, protocol_link, accepted_at, protocol_id, created_at, updated_at }] }` |
| `protocols-atlas.json`, `protocols-borealis.json` | this module | `{ meta, protocols: [{ id, po_number, protocol_number, vendor, amount, status, settlement_month, ... }], orders: [] }` |
| `vendor-info.json` | this module | `{ meta, vendors: [{ name, full_name, address, tax_id, registry_no }] }` |
| `purchase-orders.json` | you, by hand | `{ orders: [{ po_number, vendor, title, amount, area? }] }` - the order pool |
| `costs/<area>.json` or `costs/<area>/index.json` + `<YYYY-MM>.json` | an external export | worklog costs per person / issue / epic |

Areas are example teams - `atlas`, `borealis`, `comet`, `delta` (see `AREAS`
in `server/store.js` and `client/vs-lib.js`). `atlas` and `borealis` keep their
own protocols file, `comet` shares the `atlas` file and `delta` has none
(its settlements stand in for accepted amounts).

Example vendors (`VENDOR_NAME_PREFIXES` in `client/vs-lib.js`) are `Acme Ltd`,
`Globex` and `Initech`, each with the short code its people carry in front of
their name in the costs data (`ACM`, `GLX`, `INI`). Replace them with your
own; vendors saved in `vendor-info.json` are offered too.

A new team starts with no files: the first saved settlement creates
`summary.json`. When `vendor-info.json` or a protocols file exists but
`summary.json` does not, the tree is treated as half-decrypted and writes
answer `409 data-missing` rather than inventing a file. An empty data root
("end of day") is never written to.

## Configuration

| Env key | Meaning |
|---|---|
| `SETTLEMENTS_CUSTOMER_NAME` | Customer name on the protocol (default `Example Customer Ltd`) |
| `SETTLEMENTS_CUSTOMER_ADDRESS` | Customer address lines separated by `|` |
| `SETTLEMENTS_CUSTOMER_TAX_ID` | Customer tax ID |
| `JIRA_BASE_URL` | Optional; when set, epic keys link to `<base>/browse/<key>` |

The currency label is `CURRENCY` in `client/vs-lib.js`.

## Generator dependencies

`docx` and `mammoth` are dependencies of this module alone
(`package-lock.json` is part of the module). Run in the module directory:

    npm ci --omit=dev

Without them the generator buttons are disabled and `GET /status` answers
`deps: { docx: false, mammoth: false }`. The print window prints from the
client (the host CSP blocks inline scripts). The `.docx` is streamed to the
browser and never stored on the server.

## Routes (`/api/m/vendor-settlements/`)

`GET /status`, `GET /data`, `GET /protocols-all`, `GET /costs?area=`,
`POST /summary/add | update | delete | mark-accepted`, `POST /vendor-info/add`,
`POST /protocols/generate?format=pdf&project=<area>`.

"Mark as accepted" only records the acceptance; accepting the order in your
procurement system stays a manual step.

## Tests

`node --test catalog/modules/vendor-settlements/tests/test_*.mjs` - the
contract, the routes against a temporary data tree, the costs reader, the
client helpers, the chart and the protocol generator (the two real-document
cases run only when `docx` / `mammoth` are installed).
