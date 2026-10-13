// ── Mission Deck — js/dashboard-layout.mjs ────────────────────────────────
// DOM-free list helpers behind the dashboard edit mode (js/dashboard-edit-mode.js). `items` is the
// layout array `[{ module, widget, variant }]`, `available` the catalog from
// GET /api/dashboard/layout. Every function returns a NEW array; the server
// stays the judge of validity (PUT refuses anything unknown).

/** @param {{module: string, widget: string}} item @returns {string} */
export function itemKey(item) {
  return item.module + '/' + item.widget;
}

function _find(available, module, widget) {
  const mod = (available || []).find((m) => m.module === module);
  const def = mod && (mod.widgets || []).find((w) => w.id === widget);
  return mod && def ? { mod, def } : null;
}

/** Change the variant of a selected widget; an unknown variant id changes nothing. */
export function setVariant(items, available, module, widget, variantId) {
  const list = Array.isArray(items) ? items : [];
  const hit = _find(available, module, widget);
  if (!hit || !(hit.def.variants || []).some((v) => v.id === variantId)) return list.slice();
  return list.map((i) => (i.module === module && i.widget === widget ? { ...i, variant: variantId } : i));
}

/** Move the item at `from` so it ends up at index `to` (drag and drop); out of range changes nothing. */
export function moveTo(items, from, to) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return list;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const [it] = list.splice(from, 1);
  list.splice(to, 0, it);
  return list;
}

/** Drop the item of this widget; an absent widget changes nothing. */
export function removeItem(items, module, widget) {
  const list = Array.isArray(items) ? items : [];
  const key = module + '/' + widget;
  return list.filter((i) => itemKey(i) !== key);
}

/** Append the widget with its default variant; a duplicate or unknown widget changes nothing. */
export function addItem(items, available, module, widget) {
  const list = Array.isArray(items) ? items : [];
  if (list.some((i) => itemKey(i) === module + '/' + widget)) return list.slice();
  const hit = _find(available, module, widget);
  if (!hit) return list.slice();
  return [...list, { module, widget, variant: hit.def.defaultVariant }];
}

/**
 * Widgets that are NOT on the dashboard yet, grouped by module in catalog order.
 * `query` is matched case-insensitively against module name, widget label and description.
 * @returns {Array<{module: string, moduleName: string, widgets: Array<{widget: string, label: string, description: string}>}>}
 */
export function addableGroups(items, available, query) {
  const list = Array.isArray(items) ? items : [];
  const used = new Set(list.map(itemKey));
  const q = String(query || '').trim().toLowerCase();
  const groups = [];
  for (const mod of available || []) {
    const widgets = [];
    for (const def of mod.widgets || []) {
      if (used.has(mod.module + '/' + def.id)) continue;
      const description = def.description || (def.builtin ? mod.description : '') || '';
      const hay = (mod.name + ' ' + def.label + ' ' + description).toLowerCase();
      if (q && !hay.includes(q)) continue;
      widgets.push({ widget: def.id, label: def.label, description, builtin: !!def.builtin });
    }
    if (widgets.length) groups.push({ module: mod.module, moduleName: mod.name, widgets, hasData: widgets.some((w) => !w.builtin) });
  }
  // Real data widgets first, the automatic shortcuts after them; stable inside each part.
  return groups.filter((g) => g.hasData).concat(groups.filter((g) => !g.hasData));
}
