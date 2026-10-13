// Module client entry point.
// Export a `views` object keyed by view id (must match module.json views[].id).
// Each view object must have init() and render() methods.
//
// Buttons and modals here follow the shared hierarchy documented in
// modules-template/README.md ("Buttons and actions") and cockpit-conventions.md
// sections 2a/2b: exactly ONE `ds-btn--primary` per view, painted BIG into
// the header action slot module-host.js builds for every view
// (`document.getElementById('<viewId>-actions')`, a sibling of `.view-data`
// - see `js/module-host.js` `_createViewSection`); everything inside the
// view's own content stays `ds-btn--sm`. The slot is repainted in EVERY
// render(), never only on the first mount: a data refresh
// (`js/data-events.js`, `cockpit:data-changed`) rebuilds the whole section
// and hands the module back a fresh, listener-free slot.

let _wired = false;
let _dsModal = null;

async function _onSlotClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.hasAttribute('data-change-me-danger')) {
    // An irreversible action asks through the DS confirm, never through the
    // raw window.confirm: the OK button comes first and is red (danger),
    // Escape and a click beside the window answer "no", and focus returns to
    // the trigger.
    if (!_dsModal) return;
    const ok = await _dsModal.confirmDsModal({
      title: 'Are you sure?',
      body: 'This cannot be undone.',
      okLabel: 'Delete',
      danger: true,
      trigger: btn,
    });
    if (!ok) return;
    // ... the irreversible work goes here
  }
}

export const views = {
  'change-me-main': {
    /**
     * Called once when the view is first activated.
     * @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps
     */
    init(deps) {
      this._deps = deps;

      // Dynamic on purpose - the same pattern as the team-directory
      // module's client/index.js: this file must still
      // import cleanly in plain Node, with no document object and no /js/... resolver,
      // for the module's own contract test.
      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
      })();
      // No registerViewCleanup() here: init() runs ONCE per session, but the
      // cleanup registry is consumed on EVERY exit from the view, so a
      // callback registered here would cover the first exit and nothing
      // after. Register it where the listener is created - in render().
    },

    /**
     * Called every time the view is navigated to.
     * @param {string} _subPath path segment after the view id (e.g. "detail/42")
     * @param {object} _opts
     */
    async render(_subPath, _opts) {
      const root = document.getElementById('change-me-main-root');
      if (!root) return;

      const actions = document.getElementById('change-me-main-actions');
      if (actions) {
        actions.innerHTML =
          '<button type="button" class="ds-btn ds-btn--primary" data-change-me-main>Main action</button>'
          + '<button type="button" class="ds-btn ds-btn--secondary" data-change-me-refresh>Refresh</button>';
      }

      root.innerHTML =
        '<div class="ds-card"><div class="ds-card-body">'
        + '<p>Your view - fill in the implementation.</p>'
        + '<div class="ds-actions">'
        + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-change-me-details>Details</button>'
        + '<button type="button" class="ds-btn ds-btn--danger ds-btn--sm" data-change-me-danger>Delete</button>'
        + '</div>'
        + '</div></div>';

      // Idempotent, one listener on the root AND one on the slot: a delegated
      // click on `#change-me-main-root` alone never sees a click made in the
      // header slot. The cleanup removes both listeners and resets `_wired`,
      // and is registered HERE (every entry re-registers it), so the next
      // render() re-wires exactly once - never zero times, never twice.
      if (!_wired) {
        _wired = true;
        root.addEventListener('click', _onSlotClick);
        if (actions) actions.addEventListener('click', _onSlotClick);
        this._deps.registerViewCleanup(() => {
          root.removeEventListener('click', _onSlotClick);
          if (actions) actions.removeEventListener('click', _onSlotClick);
          _wired = false;
        });
      }
    },
  },
};
