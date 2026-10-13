// Dependency-free document harness: account for every retained listener, observer
// and animation frame, including the boot-global auto-enhancer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/ds-select.js', import.meta.url), 'utf8');

class Target extends EventTarget {
  listeners = [];
  addEventListener(type, fn, options) {
    const capture = options === true || !!options?.capture;
    if (!this.listeners.some(item => item.type === type && item.fn === fn && item.capture === capture)) {
      this.listeners.push({ type, fn, capture });
    }
    super.addEventListener(type, fn, { capture });
  }
  removeEventListener(type, fn, options) {
    const capture = options === true || !!options?.capture;
    this.listeners = this.listeners.filter(item => !(item.type === type && item.fn === fn && item.capture === capture));
    super.removeEventListener(type, fn, { capture });
  }
  count(type) { return this.listeners.filter(item => item.type === type).length; }
}

function harness() {
  const observers = [];
  const frames = new Map();
  let nextFrame = 0;
  const document = new Target();
  document.readyState = 'complete';
  class Element extends Target {
    constructor(tag) {
      super();
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.attributes = new Map();
      this.dataset = {};
      this.className = '';
      this.selectedIndex = 0;
      this.hidden = false;
      this.labels = [];
      const props = new Map();
      this.style = {
        get cssText() { return [...props].map(([k, v]) => `${k}: ${v};`).join(' '); },
        set cssText(value) {
          props.clear();
          for (const part of value.split(';')) {
            const [key, val] = part.split(':');
            if (key?.trim() && val?.trim()) props.set(key.trim(), val.trim());
          }
        },
        get cursor() { return props.get('cursor') || ''; },
        set cursor(value) { props.set('cursor', value); },
        getPropertyValue: name => props.get(name) || '',
        getPropertyPriority: () => '',
        setProperty: (name, value) => props.set(name, value),
        removeProperty: name => props.delete(name),
      };
      const setClasses = values => { this.className = [...values].join(' '); };
      this.classList = {
        contains: value => this.className.split(' ').includes(value),
        add: value => setClasses(new Set([...this.className.split(' ').filter(Boolean), value])),
        remove: value => setClasses(this.className.split(' ').filter(item => item !== value)),
        toggle: (value, on) => {
          const add = on ?? !this.classList.contains(value);
          this.classList[add ? 'add' : 'remove'](value);
        },
      };
    }
    get parentElement() { return this.parentNode; }
    get isConnected() { return this === document.documentElement || !!this.parentNode?.isConnected; }
    get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
    get text() { return this.textContent; }
    get tabIndex() { return Number(this.getAttribute('tabindex') ?? 0); }
    set tabIndex(value) { this.setAttribute('tabindex', String(value)); }
    get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1]; }
    get previousElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) - 1]; }
    set innerHTML(_value) { this.children.slice().forEach(child => child.remove()); }
    appendChild(child) {
      child.remove();
      this.children.push(child);
      child.parentNode = this;
      return child;
    }
    insertBefore(child, before) {
      child.remove();
      this.children.splice(this.children.indexOf(before), 0, child);
      child.parentNode = this;
    }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    contains(child) { return this === child || this.children.some(node => node.contains(child)); }
    setAttribute(key, value) {
      this.attributes.set(key, String(value));
      if (key === 'style') this.style.cssText = value;
    }
    getAttribute(key) {
      if (key === 'style') return this.style.cssText || (this.attributes.has(key) ? '' : null);
      return this.attributes.get(key) ?? null;
    }
    hasAttribute(key) { return this.getAttribute(key) !== null; }
    removeAttribute(key) { this.attributes.delete(key); if (key === 'style') this.style.cssText = ''; }
    matches(selector) {
      if (selector === 'select.ds-input') return this.tagName === 'SELECT' && this.classList.contains('ds-input');
      const name = selector.match(/^\.([\w-]+)/)?.[1];
      return !!name && this.classList.contains(name) && (!selector.includes(':not([hidden])') || !this.hidden);
    }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return { left: 10, top: 10, bottom: 50, width: 200 }; }
  }
  document.createElement = tag => new Element(tag);
  document.documentElement = new Element('html');
  document.body = document.documentElement.appendChild(new Element('body'));
  document.querySelectorAll = selector => document.documentElement.querySelectorAll(selector);
  const window = new Target();
  window.innerHeight = 900;
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.target = null; }
  }
  const context = {
    document, window, Event, MutationObserver: Observer,
    normalizeSearch: value => String(value || '').toLowerCase(),
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const code = source.replace(/^import .*;$/m, '').replace(/export \{[^}]+\};/, '');
  const api = vm.runInNewContext(code + '\n;({ initSelect, destroySelect });', context);
  const makeSelect = () => {
    const select = document.createElement('select');
    select.className = 'ds-input';
    for (const value of ['Engineering', 'Product']) {
      const option = document.createElement('option');
      option.textContent = value;
      select.appendChild(option);
    }
    document.body.appendChild(select);
    return select;
  };
  const auto = nodes => observers[0].callback([{ addedNodes: nodes }]);
  const key = (target, value) => {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'key', { value });
    target.dispatchEvent(event);
  };
  return { ...api, document, window, observers, frames, makeSelect, auto, key };
}

test('destroy removes instance listeners/observers/frames and restores native presentation', () => {
  const h = harness();
  const select = h.makeSelect();
  const label = h.document.body.appendChild(h.document.createElement('label'));
  label.textContent = 'Obszar';
  label.style.cursor = 'help';
  select.labels = [label];
  select.setAttribute('style', 'width: 180px;');
  select.setAttribute('tabindex', '3');
  select.setAttribute('aria-label', 'Module area');
  const originalStyle = select.getAttribute('style');
  const dispose = h.initSelect(select);
  assert.equal(h.initSelect(select), dispose);
  const trigger = select.parentNode.querySelector('.ds-sel-trigger');
  assert.equal(trigger.getAttribute('aria-label'), 'Module area');
  assert.equal(h.document.count('click'), 1);
  assert.equal(label.count('click'), 1);
  assert.equal(select.count('change'), 1);
  h.key(trigger, 'ArrowDown');
  h.key(trigger, 'ArrowDown');
  assert.equal(h.window.count('scroll'), 1, 'repeated open must not orphan a window listener');
  assert.equal(h.window.count('resize'), 1);
  assert.equal(h.frames.size, 1);
  dispose();
  dispose();
  assert.equal(h.document.count('click'), 0);
  assert.equal(label.count('click'), 0);
  assert.equal(select.count('change'), 0);
  assert.equal(trigger.count('keydown'), 0);
  assert.equal(h.window.listeners.length, 0);
  assert.equal(h.frames.size, 0);
  assert.equal(h.observers.filter(observer => observer.target).length, 1, 'only global auto-enhancer remains');
  assert.equal(select.parentNode, h.document.body);
  assert.equal(select.getAttribute('style'), originalStyle);
  assert.equal(select.getAttribute('tabindex'), '3');
  assert.equal(label.style.cursor, 'help');
  assert.equal(select._dsEnhanced, undefined);
});

test('disposal suppresses queued auto-enhancement but explicit reinit and other selects work', () => {
  const h = harness();
  const select = h.makeSelect();
  h.auto([select]);
  for (let i = 0; i < 20; i++) {
    h.destroySelect(select);
    h.auto([select, h.document.body]);
    assert.equal(select._dsEnhanced, undefined);
    assert.equal(h.document.count('click'), 0);
    assert.equal(select.getAttribute('style'), null);
    assert.equal(select.getAttribute('tabindex'), null);
    h.initSelect(select);
    assert.equal(h.document.count('click'), 1);
    assert.equal(h.observers.filter(observer => observer.target === select).length, 2);
  }
  h.destroySelect(select);
  const other = h.makeSelect();
  h.auto([other]);
  assert.equal(other._dsEnhanced, true);
  const detached = h.makeSelect();
  detached.remove();
  h.auto([detached]);
  assert.equal(detached._dsEnhanced, undefined, 'queued records never enhance removed roots');
});

test('keyboard selection, external change sync, label focus and disabled sync survive reinit', () => {
  const h = harness();
  const select = h.makeSelect();
  const label = h.document.body.appendChild(h.document.createElement('label'));
  label.textContent = 'Obszar';
  select.labels = [label];
  let changes = 0;
  select.addEventListener('change', () => { changes++; });
  const firstDispose = h.initSelect(select);
  firstDispose();
  h.initSelect(select);
  firstDispose();
  const trigger = select.parentNode.querySelector('.ds-sel-trigger');
  assert.equal(trigger.getAttribute('aria-label'), 'Obszar');
  h.key(trigger, 'Enter');
  h.key(select.parentNode.querySelectorAll('.ds-sel-opt')[1], 'Enter');
  assert.equal(select.selectedIndex, 1);
  assert.equal(changes, 1);
  assert.equal(h.document.activeElement, trigger);
  select.selectedIndex = 0;
  select.dispatchEvent(new Event('change'));
  assert.equal(select.parentNode.querySelector('.ds-sel-text').textContent, 'Engineering');
  label.dispatchEvent(new Event('click', { cancelable: true }));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  h.document.dispatchEvent(new Event('click'));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  select.disabled = true;
  h.observers.find(observer => observer.target === select && observer.options.attributes).callback();
  assert.equal(trigger.disabled, true);
  h.destroySelect(select);
  assert.equal(select.count('change'), 1, 'application listener is not owned by DS');
});

test('area table lifecycle disposes loading headers and keeps one view cleanup per visit', async () => {
  const cleanups = [];
  const destroyed = [];
  const native = new Target();
  const loadingSelect = new Target();
  let current = [native];
  const root = { querySelectorAll: () => current };
  const areaSource = readFileSync(new URL('../js/module-area-modal.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '')
    .replaceAll("await import('./ds-select.js')", 'dsModule')
    .replaceAll('export ', '');
  const { createAreaSelectLifecycle } = vm.runInNewContext(areaSource + '\n;({ createAreaSelectLifecycle });', {
    dsModule: { destroySelect: select => destroyed.push(select) },
    registerViewCleanup: (id, callback) => { assert.equal(id, 'settings'); cleanups.push(callback); },
  });
  const lifecycle = createAreaSelectLifecycle('select');
  await lifecycle.prepare(root);
  lifecycle.bind(native, () => {});
  assert.equal(native.count('change'), 1);
  await lifecycle.prepare(root);
  assert.equal(native.count('change'), 0);
  assert.equal(cleanups.length, 1);
  current = [loadingSelect];
  cleanups.pop()();
  assert.equal(destroyed.at(-1), loadingSelect);
  await lifecycle.prepare(root);
  assert.equal(cleanups.length, 1, 'returning to settings registers a fresh cleanup');
});
