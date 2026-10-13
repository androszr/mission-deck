// demo/chapters/feedback.mjs
// Chapter `feedback` ("Send feedback"): the top-bar question-mark button
// (#topbar-help-btn, js/topbar.js) opens the window of js/feedback-modal.js.
// A bug report is typed field by field (Title is required, the two bug-only
// fields follow), a screenshot is pasted, "Send" disables the footer while
// the server (handleFeedbackSubmit in server.js) creates the branch
// `feedback/<type>-<stamp>-<slug>`, one commit with
// feedback/<dir>/report.md plus attachments/, and the merge request - the
// real success callout, toast and the "FB" chip in the "MR:" slot follow, and
// the merge request page shows what landed. Then a "Question" without the
// VPN (the real "unreachable" message and the "Copy report"
// fallback) and, with the VPN back, a quick "Idea" that makes it "FB 2". Mocks in demo/mocks/ch-feedback.mjs; the
// Modules tab behind the window reuses the katalog / nowy-modul painters.
// Nothing is sent, copied or created.

import { narrate, VAULT_OPEN } from './_helpers.mjs';
import { ZGLOSZENIA_REPORTS as R } from '../mocks/ch-feedback.mjs';

const Z = '#zgloszenia-';
const MODAL = Z + 'modal';

/** The real "unreachable" copy of feedbackErrorMessage (js/feedback-helpers.mjs). */
const UNREACHABLE = 'Could not connect to GitLab. Check your network connection (VPN, if your GitLab needs one) and try again.';

const mr = (zg) => ({ type: 'show', mock: 'zgloszenia-topbar-mr', target: '#topbar-mr-root', props: { zg } });

/** Cursor to the question mark in the top bar, click, the window opens (Bug active). */
const openModal = [
  { type: 'click', target: '#topbar-help-btn' },
  { type: 'modal', open: 'zgloszenia-modal' },
];

/** "Send": _setBusyUi disables the X and "Cancel" and paints the hint while the request is out. */
const busy = [
  { type: 'click', target: Z + 'submit' },
  { type: 'show', mock: 'zgloszenia-footer', target: Z + 'footer', mode: 'outer', props: { busy: true } },
  { type: 'show', mock: 'zgloszenia-close', target: Z + 'close', mode: 'outer', props: { disabled: true } },
  { type: 'wait', ms: 1100 },
  { type: 'show', mock: 'zgloszenia-close', target: Z + 'close', mode: 'outer' },
];

/** "Send" that succeeds: the busy state, then _paintSuccess and the "FB" chip. */
const sendOk = (zg) => [
  ...busy,
  { type: 'show', mock: 'zgloszenia-success', target: Z + 'body' },
  { type: 'show', mock: 'zgloszenia-success-footer', target: Z + 'footer', mode: 'outer' },
  { type: 'toast', variant: 'success', title: 'Feedback sent', desc: 'Thank you for the report.' },
  mr(zg),
];

/** "Close" in the success footer closes the window. */
const closeSuccess = [
  { type: 'click', target: Z + 'success-close' },
  { type: 'modal', close: MODAL },
];

/** Pick another report type: the segment repaints, the bug-only fields hide. */
const pickType = (type) => [
  { type: 'click', target: `${Z}type-${type}` },
  { type: 'show', mock: 'zgloszenia-type', target: Z + 'type', mode: 'outer', props: { type } },
  { type: 'hide', target: Z + 'steps-wrap' },
  { type: 'hide', target: Z + 'expected-wrap' },
];

export default {
  setup: [
    // Settings > Modules as the earlier chapters left it: the window opens over it.
    { type: 'show', mock: 'nowy-modul-installed', target: '#settings-moduly-installed', props: { demoStatus: 'stable' } },
    { type: 'show', mock: 'katalog-catalog', target: '#settings-moduly-catalog' },
    VAULT_OPEN,
    mr(0),
  ],
  steps: [
    {
      id: 'zgloszenia-przycisk',
      caption: 'Something is off in Settings — I click the **question mark** in the top bar.',
      mascot: 'error',
      camera: 'full',
      actions: [
        narrate('Send feedback', 'The question mark in the top bar is always at hand, on every view. It opens the “Send feedback” window: a bug, an idea or a question, with a description and screenshots. The window remembers on its own which view you were on.'),
        { type: 'navigate', view: 'settings', tab: 'modules' },
        { type: 'camera', target: '.app-top-bar', zoom: 1.6 },
        { type: 'hover', target: '#topbar-help-btn', ms: 900 },
        { type: 'camera', full: true },
        ...openModal,
        { type: 'camera', target: MODAL + ' .ds-modal', zoom: 1.15 },
      ],
    },
    {
      id: 'zgloszenia-description',
      caption: 'The **Bug** type is already selected — I type the title, the description, the steps and what I expected.',
      mascot: 'working',
      actions: [
        narrate('Bug: four fields', 'The title is required — without it “Send” only reminds you of it. A bug adds two fields: the steps to reproduce and what you expected. An idea and a question do not have them.'),
        { type: 'type', target: Z + 'title', text: R.bug.title },
        { type: 'type', target: Z + 'desc', text: R.bug.desc },
        { type: 'scroll', target: Z + 'steps' },
        { type: 'type', target: Z + 'steps', text: R.bug.steps },
        { type: 'scroll', target: Z + 'expected' },
        { type: 'type', target: Z + 'expected', text: R.bug.expected },
      ],
    },
    {
      id: 'zgloszenia-screenshot',
      caption: 'I paste a **screenshot** straight from the clipboard — a thumbnail and the counter 1 / 5 appear.',
      mascot: 'working',
      actions: [
        narrate('Screenshot', 'You paste a screenshot with Cmd+V (Ctrl+V on Windows and Linux) or pick a file. Up to five PNG, JPG, GIF or WebP images, up to 3 MB each. The screenshot goes to the app repository, which the whole team can see.'),
        { type: 'scroll', target: Z + 'dropzone' },
        { type: 'camera', target: Z + 'shots', zoom: 1.35 },
        { type: 'click', target: Z + 'dropzone' },
        { type: 'show', mock: 'zgloszenia-thumbs', target: Z + 'thumbs-slot', props: { shots: 1 } },
        { type: 'scroll', target: Z + 'counter' },
        { type: 'camera', target: Z + 'shots', zoom: 1.2 },
        { type: 'hover', target: Z + 'thumb-0', ms: 800 },
      ],
    },
    {
      id: 'zgloszenia-wyslij',
      caption: 'I click **Send** — the server creates a branch, a commit and a merge request in the app repository.',
      mascot: 'working',
      actions: [
        narrate('Sending', 'While sending, the window locks “Cancel” and the X. Through the GitLab API the server creates a report/… branch, writes a feedback/ folder with the report.md file and the screenshot in one commit, then opens a merge request with the feedback label.'),
        { type: 'camera', full: true },
        { type: 'camera', target: MODAL + ' .ds-modal', zoom: 1.15 },
        ...sendOk(1),
      ],
    },
    {
      id: 'zgloszenia-mr',
      caption: 'I open the **merge request** — it holds my description, the view, the folder and the screenshot.',
      mascot: 'wave',
      actions: [
        narrate('Where the report lands', 'The merge request carries the type, the author, the view, the number of screenshots and the folder with the files — the Mission Deck maintainer reviews it like any other change. The branch goes away after the merge.'),
        { type: 'camera', full: true },
        { type: 'click', target: Z + 'mr-link' },
        { type: 'surface', show: 'screen', mock: 'zgloszenia-mr-screen' },
        { type: 'camera', target: Z + 'mr-head', zoom: 1.3 },
        { type: 'wait', ms: 700 },
        { type: 'camera', full: true },
        { type: 'hover', target: Z + 'mr-desc', ms: 900 },
        { type: 'hover', target: Z + 'mr-files', ms: 900 },
      ],
    },
    {
      id: 'zgloszenia-kopiuj',
      caption: 'A question without the VPN does not go out, so I click **Copy report** — the text waits in the clipboard.',
      mascot: 'thinking',
      actions: [
        narrate('When GitLab does not answer', 'The “FB 1” counter in the bar is the open feedback from the app. Without the company network the server cannot reach GitLab: the window stays open with what you typed, says what to check, and offers “Copy report” — the text goes to the clipboard as Markdown.'),
        { type: 'camera', full: true },
        { type: 'surface', show: 'cockpit' },
        ...closeSuccess,
        { type: 'camera', target: '#topbar-mr-root', zoom: 2 },
        { type: 'hover', target: Z + 'chip-zg', ms: 1000 },
        { type: 'camera', full: true },
        ...openModal,
        { type: 'camera', target: MODAL + ' .ds-modal', zoom: 1.15 },
        ...pickType('question'),
        { type: 'type', target: Z + 'title', text: R.question.title },
        ...busy,
        { type: 'show', mock: 'zgloszenia-error', target: Z + 'status', props: { message: UNREACHABLE } },
        { type: 'show', mock: 'zgloszenia-footer', target: Z + 'footer', mode: 'outer' },
        { type: 'scroll', target: Z + 'status' },
        { type: 'click', target: Z + 'copy' },
        { type: 'toast', variant: 'success', title: 'Copied', desc: 'The report text is in the clipboard.' },
      ],
    },
    {
      id: 'zgloszenia-idea',
      caption: 'With the VPN back I send an **Idea** — just a title and a description, and the FB counter goes up to two.',
      mascot: 'success',
      actions: [
        narrate('Idea', 'Every opening starts with a clean form with the “Bug” type. I switch to “Idea”: the steps and expected-result fields disappear. With the VPN back the sending goes through, and a second report to review appears in the bar.'),
        { type: 'camera', full: true },
        { type: 'click', target: Z + 'cancel' },
        { type: 'modal', close: MODAL },
        ...openModal,
        { type: 'camera', target: MODAL + ' .ds-modal', zoom: 1.15 },
        ...pickType('idea'),
        { type: 'type', target: Z + 'title', text: R.idea.title },
        { type: 'type', target: Z + 'desc', text: R.idea.desc },
        ...sendOk(2),
        ...closeSuccess,
        { type: 'camera', target: '#topbar-mr-root', zoom: 2 },
        { type: 'hover', target: Z + 'chip-zg', ms: 1200 },
      ],
    },
  ],
};
