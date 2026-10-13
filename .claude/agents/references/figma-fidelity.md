# Figma -> CSS fidelity reference (prototypes)

How to turn a Figma reference into correct prototype CSS, and the platform facts that silently
break fidelity whether or not a Figma file exists. Consumed by `frontend-implementer` (mandatory
read before the first screen of any `/prototype` build), `proto-ds-guardian` (applied in
review-impl) and `playwright-specialist` (applied in Phase 6g).

Paths: prototypes live in `data-sub-repositories/ds-data/prototypes/<id>/`; the team's optional
DS adapters and device chrome in `ds/` and `components/` next to them; the icon catalog is the one
`scripts/check-proto-ds.js` validates slugs against. The withdrawn `--fds-*` namespace is NOT a
token source for new CSS.

Every rule below comes from a real defect that shipped in a prototype. Each one
names its precedent so you can tell "this actually happened" from "this sounds nice". Extend this
file (with the precedent) whenever a new class of fidelity bug is found, instead of growing the
skill's hard-rule list.

**Sections marked "with a reference" apply only when the build has a Figma reference** -
`figma_reference_dir: user-data/figma-reference/<id>/` from `/prototype` Phase 1. Every other
section applies to EVERY prototype build.

## The reference bundle (what Phase 1 writes)

`/prototype` Phase 1 ingests a Figma link with `scripts/figma_reference.py` (Figma REST API, run by
the server behind `GET /api/figma-reference/stream`) into `user-data/figma-reference/<id>/`
(gitignored, never inside `prototype_dir`):

| File | Content |
|---|---|
| `frames.json` | one row per frame in scope: `{ frameId, name, width, height, platform, section, lastModified, fileKey }` |
| `section-<slug>.md` | the layout tree of one Figma section/page: per node its direction, `W x H`, `gap`, `pad`, radius, background, `[inst]` for a component instance, plus a `### Text elements` table (style, exact string, colour) |
| `screenshots/<frameId>.png` | the frame rendered by `get_screenshot` (when the MCP result can be saved; otherwise Phase 6g calls `get_screenshot` for that frame id directly) |
| `token-map.md` | every hex that occurs in the trees -> the token that expresses it (an app or build-shell token such as `--body-*`/`--form-*`/`--state-*`), `NO-MATCH` when none does |

Freshness is decided by `lastModified` from the MCP answer against the stored one; a waiver (build
without the reference) is only ever a user decision recorded in the plan.

---

## 1. Where numbers come from (with a reference)

**The frame's layout tree in `section-*.md` is the contract.** Every `[inst]` line carries the
component's ACTUAL size *in that frame*:

```
- web / empty-state [inst]: V 432x328 gap=32 pad=32
  - uni / avatar [inst]: H 80x80 ... r=1000
  - text-part: V 368x72 gap=8
```

That reads: component 432 wide x 328 tall, 32px gap between children, 32px padding; text block
368 wide with 8px internal gap.

### Aggregates are NOT a spec

A component catalog and any
summary the MCP gives for a whole file (component usage counts, "most common size") pool every
instance across the file. The most frequent size is usually the **mobile** one, so reading
dimensions from an aggregate gives you the wrong breakpoint's numbers. A catalog entry is the
authority for component SHAPE (variants, states, anatomy), never for the size of one instance.

> **Precedent (2026-08-29):** `web / empty-state` was built at 340px because that size dominated
> the file-wide component table; the desktop frame's instance was **432x328**. Result: a visibly
> too-narrow empty state.

**Rule:** open the layout tree for the frame you are building, at the breakpoint you are building.
Never size a component from an aggregate or from another frame.

## 2. Never invent constraints (with a reference)

If the tree says `V 432x328`, the component is 328 tall. Do **not** add `min-height`, `min-width`,
`max-height`, or vertical centering "so it fills the area". Auto-layout in the parent already
positions it.

> **Precedent (2026-08-29):** an invented `min-height: 500px` on a 328px empty-state added ~170px
> of dead space and pushed the next section off-screen.

Same for decoration: if the tree has no divider node, there is no divider.

> **Precedent (2026-08-29):** vertical `border-right` dividers were invented between three stat
> columns that the tree renders as plain `deco-text-list` siblings.

**Rule:** every `min-*` / `max-*` / border / background you write must trace to a node in the tree.
If you cannot point at the line, delete the declaration. Without a reference the same rule holds
against the plan: a dimensional constraint the plan does not state is not yours to add.

## 3. Derive the whole box, then check the sum (with a reference)

A row spec like:

```
- uni / table-cell [inst]: H 948x256 border-b=#e5e5e5
  - uni / table-cell-lines [inst]: V 948x256 gap=16 pad=16
    - table-cell-content: H 916x24     (name)
    - table-cell-content: H 916x50     (stats)
    - table-cell-content: H 916x118    (input block)
```

decomposes as `16 + 24 + 16 + 50 + 16 + 118 + 16 = 256`. **Do the arithmetic.** If your sum does
not reach the frame's stated height, a gap or padding is wrong. Content width `916 = 948 - 2x16` -
a child rendering at 948 means you dropped the horizontal padding.

Equal columns: `deco-text-list ... 305.333x50` x 3 inside 916 means `916 / 3` - `flex: 1` with
**zero** extra padding, not text-fit and not spread across a wider parent.

## 4. Text comes from the text table, verbatim (with a reference)

The `### Text elements` table gives style, exact string and colour:

| Style | Text | Color |
|---|---|---|
| 16/500 (lh 24) | `Wynik:` | `#262626` |
| 16/500 (lh 24) | `76,1%` | `#595959` |

`16/500 (lh 24)` = `font-size: 16px; font-weight: 500; line-height: 24px`. The colour column is
resolved through `token-map.md`, never pasted as hex.

Copy the string **including punctuation** - a label is `Score:` with the colon. A label/value pair
in two colours is two elements, not one string.

> **Precedent (2026-08-29):** `Score` shipped without its colon while the sibling
> `Lost revenue:` kept it; one stat rendered as a single flat string instead of a coloured
> label/value pair.

## 5. Icons follow `currentColor` - tint the parent, never target `svg`

`DSIcon` (the team's icon adapter, when present) renders a CSS-mask
`<span role="img" data-icon="<slug>">` painted with `background-color: currentColor` (the SVG files
carry a hardcoded grey stroke, which is why a plain `<img>` could never be recoloured).
Consequences:

- An icon takes the **text colour of its parent**: green inside a primary `DSLink`, white inside a
  primary `DSButton`, `--body-secondary-text` inside a grey label. To tint one icon set `color:` on
  its wrapper (a class on the wrapping element) - never on an `svg` selector. There is no inline
  `<svg>` in the document for a catalog slug; such a rule matches nothing and fails silently.
- Icons do not default to grey. When the design shows a grey icon next to dark text (table-header
  sort glyph, a tertiary hint icon), give the wrapper an explicit
  `color: var(--body-tertiary-text)` / `--body-secondary-text`.
- `tint={false}` renders the raw `<img>` for multi-colour artwork (logos, illustrations) only.
- `filter: brightness(0) invert(1)` and hand-rolled `mask` utilities are obsolete for DS icons -
  delete them when touching a prototype (the mask is already inside `DSIcon`).

### `DSIcon` is DUAL-PATH - pick the right one

| Path | Pass | Renders | When to use |
|---|---|---|---|
| **A - catalog slug** | a string slug, e.g. `name="24-ic-close"` | the mask span above | The default. Any glyph in the icon catalog; `scripts/check-proto-ds.js` validates the slug (`unknown-icon`). |
| **B - package icon component** | an `Icon*` component re-exported through `'../../ds'` | the package's own inline `<svg>`, inheriting `currentColor` natively | A glyph the team's DS package ships but the catalog export lacks. |

Both paths take the parent's text colour. Path A's slug is linted against the catalog, path B's
component is type-checked (`tsc -b`). Never import `Icon*` from a DS package directly in
`index.tsx` - `_protoValidateTsx` in `server.js` rejects it.

**Pick the slug by its shape, not its name.** Open the catalog SVG of a slug before using it (`24-ic-sos-external` is a
lifebuoy, `24-ic-settings` is a gear - names mislead).

> **Precedent (2026-08-29):** three icons shipped grey against a green/white design because
> `.x svg { color: ... }` targeted an element that does not exist.
> **Precedent (2026-09-02):** an external-link glyph next to a green link stayed grey because the
> old `<img>` render ignored `color`; the mask rewrite fixed it for every prototype.

Lift the icon **size** from the tree when there is one (`16 / ic_chevron_bottom [inst]: 16x16`
means `size={16}` and the `16-ic-*` slug, not `24-ic-*`).

## 6. Tokens: check the value, do not trust the name

A `--state-*-border` token may resolve to **`transparent`**. A validation border using it is
invisible.

> **Precedent (2026-08-29):** the goal input's error state had been "implemented" against
> `--state-danger-border` and never showed a red border.

Form fields belong to the `--form-primary-*` family: `--form-primary-default-border`,
`--form-primary-hover-border`, `--form-primary-focused-border`, `--form-primary-error-border`;
radius from `--radius-s` 4 / `--radius-m` 8 / `--radius-l` 16.

**Rule:** resolve a token before using it, against the two files a prototype can see:

```bash
grep -- '--token-name:' templates/prototype-build-shell/src/tokens.css
grep -- '--token-name:' css/ds-tokens.css
```

A name that appears in neither is undefined and silently renders its `var()` fallback - the
linter reports it as `unknown-token`. The withdrawn `--fds-*` namespace is exactly this failure mode: never reach for
it in new prototype CSS.

Prefer copying the token set the DS component for that role already uses (read its
`<Name>.module.css`). Magic numbers (`border-radius: 10px`) are a smell.

## 7. Interactive states are part of the spec

Static frames show the resting state only, so focus/hover get forgotten - and the browser then
paints its **own** blue focus ring, which is never the design.

> **Precedent (2026-08-29):** the goal input had no `:focus`/`:hover` rule at all; the UA default
> `outline: auto rgb(0,95,204)` was what users saw.

**Rule:** any control you build gets `:hover` and `:focus` sourced from the matching DS component's
CSS module. Never add a per-prototype bare `outline: none`: it is acceptable only alongside a
visible replacement (a border colour change).

## 8. Behaviour the static frames cannot show

Figma has no scroll position, no default expansion, no transitions. These must be decided
deliberately:

- **Scroll to top on screen change.** SPA state switches keep the previous scroll offset - a
  navigated-to screen lands mid-page. Add a `useEffect` on the screen state that resets the scroll
  container (the nearest `overflow: auto` ancestor, e.g. the `MobileShell` content area) to
  `scrollTop = 0`.
- **Scroll to newly revealed content.** If an action expands a section elsewhere on the page,
  scroll it into view - otherwise the user cannot tell anything happened.
- **Default expanded/collapsed state.** Decide it from the screenshot; a tree only shows the
  captured state.
- **Screen state in the URL.** A prototype with more than one screen keeps the active screen (and
  the selected record) in the hash, so reload and Back land where the user was; `useDemoState`
  owns `?state=`, the prototype never writes that param. Structure pattern: `parseHash` /
  `hashForState`.

> **Precedent (2026-08-29):** opening a location from a scrolled list landed mid-page; saving goals
> auto-expanded a section far below the viewport with no scroll, so the prompt was invisible.
> **Precedent (2026-09-11):** a new prototype shipped without hash state - every refresh dumped
> the user back to the list.

## 9. Platform parity

Mobile and desktop render from the same `index.tsx` but often diverge in their own screens. When
you fix behaviour on one platform, check whether the other has the same screen - and vice versa:
**when one platform already has a behaviour, the other is probably missing it, not exempt from
it.**

> **Precedent (2026-08-29):** mobile had the scroll-to-nudge `useEffect` and the explanatory
> banner; the desktop screen had neither.

## 10. Mobile base rules leak into desktop overrides

Shared classes carry mobile-first base declarations. A `@container proto (min-width: ...)`
override that changes the layout model can be silently broken by one.

> **Precedent (2026-08-29):** a `margin-top: 6px` on the mobile base class pushed a desktop flex
> row from the intended 48px to 54px.

**Rule:** when you re-layout a shared class for desktop, explicitly reset the base's
`margin`/`padding`/`display` rather than assuming they are neutral. Measure the result (section 13)
instead of trusting the override.

## 11. Real data overflows design placeholders

Design strings are short and hand-picked. Production values are not.

> **Precedent (2026-08-29):** the page title `Location 0042, 6 Example Square,
> Springfield` wrapped to two lines and pushed the whole page down.

**Rule:** any text bound to data (location name + address, person name, long label) gets
`white-space: nowrap; overflow: hidden; text-overflow: ellipsis` unless the design explicitly shows
a multi-line block. Translated labels run long. A table column that can be pushed out of view is the
same defect one level up - check it at every declared breakpoint by reading the screenshot back
(section 13), not by `scrollWidth`.

## 12. Structure before style

Some "wrong style" bugs are really wrong element placement - no CSS fixes them.

> **Precedent (2026-08-29):** the ranking tabs sat as a sibling *after* the page header, so the
> header's bottom border drew a grey line **above** the tabs. The design nests the tabs inside the
> header block, which puts that line **under** them. The fix was passing the tabs through the
> header's `bottom` prop - the pattern a sibling screen already used.

**Rule:** compare the design's **nesting** to your JSX nesting before adjusting borders/margins.
When another screen in the same prototype already renders the same component, copy that screen's
structure.

## 13. Verify by measuring, not by looking (with a reference)

Screenshot comparison misses 6px. Read the numbers out of the live page and diff them against the
layout tree:

```js
// in the browser (playwright browser_evaluate)
const el = document.querySelector('.<id>-target');
const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
({ w: Math.round(b.width), h: Math.round(b.height), pad: cs.padding, gap: cs.gap })
```

Check per screen: outer box w/h, padding, gap, each child's w/h, font-size / line-height / colour,
border colour, radius. State the Figma number next to the measured one so a mismatch is obvious.
Severity in Phase 6g: a delta > 2px is at least MINOR, > 8px or a wrong colour/token is MAJOR.

**Gotchas that produce false readings:**
- When a prototype renders both platforms into the document, the hidden one measures `0`. Scope every
  query to the visible platform's wrapper.
- `transition` means a state colour read immediately after `.focus()` is still the old value. Wait
  ~250ms before reading, or the state looks broken when it is fine.
- To check a cascade on a hidden subtree, append a probe element with the class inside it, measure,
  then remove it.
- A clipped column does not show up in `document.documentElement.scrollWidth` when an ancestor has
  `overflow: hidden` - read the PNG back.

Without a reference there are no Figma numbers to diff; the INTERACTION checks (section 16) and
the "read the PNG" rule still apply.

## 14. Overriding a shared DS component

The team's shared `ds/` layer is **read-only** in `/prototype`. Before styling a
`DS*` component, read how it is built: its `<Name>.module.css` (and for the adapters that have no
module CSS - `DSTable`, `DSDatepicker`, `DSRangePicker`, `DSHint`, `DSContextMenu`, `DSLegend`,
`DSIndicator` - the `<Name>.tsx`). Do not override its padding or height blindly to hit a pixel
value. When a DS component genuinely does not match the design for your screen, override it in the
prototype's own `styles.css`, scoped by your wrapper class.

**Target structure, never CSS-module class names** - they are hashed (`_tab_149a3_1`) and change on
every build:

```css
/* DSTabs renders <nav><button role="tab">... */
.<id>-rank-tabs button[role="tab"] { min-width: 120px; height: 48px; }
```

Report the mismatch in your output - a DS component that disagrees with the catalog is a
`/new-idea` fix affecting every prototype, not just yours.

> **Precedent (2026-08-29):** `DSTabs` (underline) rendered 38px tall, text-fit tabs; the catalog
> specifies `120x48` with 16px text.

## 15. Container / child background patterns

A "card" in these designs is frequently a **grey panel with white boxes inside**, not a white
bordered card:

```
- List: V 948x436 pad=24 bg=#f2f2f2   <- grey panel
  - Heading: H 900x64 bg=#ffffff      <- white box
  - Frame:   V 900x108 bg=#ffffff     <- white rows
```

Check the parent's background before styling the child, and give the child an explicit background
token - a transparent child on a grey parent reads as grey.

> **Precedent (2026-08-29):** goal cards rendered transparent on their grey grid; a supporting
> block rendered as a bordered white card where the design specifies a grey panel.

## 16. React interaction traps

Interaction affordances are part of the contract, not polish: screenshots are captured at rest and
numeric probes read the default state, so a missing affordance passes every other gate.

> **Precedent (2026-09-11):** a build passed the linter, the blind AC verifier, the DS guardian and
> a 21-pair fidelity audit - and every defect the user then reported was an interaction state
> (hover, cursor, label-click, double border).

### 16a. The nested-control double toggle

A DS control nested inside a clickable container fires **both** handlers: the control's `onChange`
and the container's `onClick`. Two toggles = no change, and it looks like the control is dead.

> **Precedent (2026-08-29):** clicking a goal card's `DSCheckbox` did nothing, while clicking the
> card body worked.

**Rule:** wrap the nested control and stop propagation, or guard the row handler on the event
target:

```jsx
<span onClick={(e) => e.stopPropagation()}>
  <DSCheckbox checked={checked} onChange={() => toggle(id)} />
</span>
```

Always test the control **itself**, not only its container.

### 16b. The label must toggle too - and the two DS controls differ

`DSCheckbox` passes its `label` to the package, which generates an `id` and a matching
`<label for>`, so **clicking its label already toggles natively**. `DSRadio` does **not** - the
package renders the option text as a bare `<label>` with no `htmlFor` and no `id`, so clicking
"Yes" / "No" does nothing.

> **Precedent (2026-09-11):** no checkbox or radio responded to a label click. The checkbox label
> already worked; the radio label was dead at package level; rows that composed extra content as
> siblings *outside* the package's own `<label>` were dead for that extra content only.

`ds/` is read-only from a prototype, so fix it prototype-side with a delegated handler that
forwards a click on the `<label>` to its preceding `[role="radio"]` sibling - structural markup shape,
never a hashed class (section 14):

```jsx
onClick={(e) => {
  const t = e.target as HTMLElement;
  if (t.tagName !== 'LABEL') return;          // guard: no double-toggle
  const btn = t.previousElementSibling as HTMLElement | null;
  if (btn?.getAttribute('role') === 'radio' && !btn.hasAttribute('disabled')) btn.click();
}}
```

For a row that adds its own content next to the control, put the `onClick` on the row and skip it
when the click landed inside `label` or the control itself. Disabled rows stay inert from the row
as well as from the box.

### 16c. A clickable row with no hover and no pointer is a defect

Every clickable row / card / list item needs `cursor: pointer` and a visible hover state from a
real token - e.g. `background: var(--table-primary-hover-bg)` for a table-like row, or the
matching `--clickable-*-hover-bg` for a card. Never a hex fallback inside `var()`: the linter
treats it as `hardcoded-color`.

Two related traps. First, the hover band must not butt against the text - cells need their
padding. Second, when a row is split across a gutter (a timeline axis, an icon rail), a background
set on the *content* column starts after the gutter and reads as a clipped rectangle; put the band
on the whole row, or extend it back across the gutter.

Do not confuse this with a package hover the catalog does not sanction: a DS package's table row
hover may paint a full **border frame**, while the catalog's `border=none` cell has no hover variant.
The answer is to suppress the frame *and* add the background - not to ship no affordance.

When you extend the band across a gutter with an absolutely positioned `::before`, give it
**`z-index: -1`**: a positioned pseudo-element paints above its parent's non-positioned in-flow
children, so without it the band covers the row's own text.

> **Precedent (2026-09-11), same element, third iteration:** the band widened with
> `:hover::before { inset: 0 0 0 -40px }` swallowed the date, time, label and author. Computed
> styles were no help; `document.elementFromPoint()` over a cell is the probe that settles it - it
> returns the band instead of the text when the stacking is wrong.

### 16d. Floating layers and fixed overlays

Any popover-like layer opened next to a trigger (filter dropdown, range calendar, hint, "more"
menu) is a `DSPopover` (custom content) or `DSDropdown` (plain item list) - both close on outside
pointerdown + Escape and flip/shift to stay in the viewport. When the markup must be owned locally,
use the exported hooks `useDismissable(open, onDismiss, [refs])` +
`usePopoverPlacement(open, anchorRef, layerRef, { side, align, offset })` - never a hand-rolled
`document.addEventListener('click')` or `top: calc(100% + ...)`.

Never put `transform` (`translateZ(0)`, `translate3d`, `scale`, `rotate`, `perspective`) on the
mobile wrapper or any ancestor of `DSBottomSheet`/`DSModal`: a transform creates a containing block
for `position: fixed` descendants, so the overlay is trapped in that box and renders behind the
bottom navigation. If compositing is needed, `will-change: scroll-position` on the scroll container
only.

> **Precedent:** bottom sheets broke on real mobile devices twice because of a `translateZ(0)` on an
> ancestor.

### 16e. Table column widths: plain `%` or plain `px`, never a mixed `calc()`

In a `table-layout: fixed` table Chrome treats a cell width written as `calc(<percent> - <px>)`
(or `calc((100% - 119px) * 0.35)`, which it simplifies to the same thing) as `auto`: every column
gets an equal share, and a resize handle that writes new fractions moves nothing. To reserve a fixed
column next to resizable ones, give the fixed one its `px` width and leave the others as plain
percentages summing to 100% - the browser gives the `px` column its width and shares the rest by
those percentages. Verify by measuring `th` widths after a drag, not by reading the inline style.

> **Precedent:** one tab of a product table had an
> extra fixed column (119 px); its six shared columns were wrapped in
> `calc((100% - 119px) * f)`, so all were 247 px and column resizing did nothing on that tab only.

## 17. Figma inconsistency triage (with a reference)

Figma is not internally consistent - a component-set default can disagree with how the component is
actually used in a real frame, and a generated annotation (`get_design_context` code) can disagree
with what the frame's own screenshot shows. When two Figma sources disagree, use this explicit
precedence order - never resolve silently in your head:

1. **The frame that places the component in context** (the layout you are building, with its real
   neighbours) - beats
2. **the component set** (the isolated variant definitions) - which beats
3. **the DS catalog** (`css/ds.css` and its tokens) - the most generic source.

Screenshot vs generated code: **the screenshot always wins.** It is the rendered truth; generated
code is a derived guess that can be stale or simply wrong.

**Precedents:**
- `uni / badge` `size=big` - the component-set default is `padding: 0 8px`, the list frame that
  actually uses it specifies `padding: 0 12px`. Build to the frame.
- Generated code annotated `justify-end` for one row, the frame's screenshot shows it
  left-aligned. Build to the screenshot.

Every case resolved against the lower-precedence side MUST be listed in the build report (frame
id + the two values + which one won), so the conflict reaches the design team instead of being
buried as a builder's judgment call. A case where the build deliberately departs from the Figma
is not triage - it is a deviation and goes to `spec.json` `figmaDeviations[]` only after the user
confirms it (`/prototype` Phase 6g).
