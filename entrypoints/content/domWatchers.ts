import { loadPolicy, isHostEnabled, isKindBlocked, type Policy, type PiiKind } from '../core/policy';
import { callRedactApi, type NerEntity } from '../core/mockRedactApi'; 

interface EditorCtx {
  el: HTMLTextAreaElement | HTMLElement; // textarea, input[type=text], or contenteditable
  lastMap: Record<string, string>;       // token -> original
  lastRedactions: { id: string; kind: string; value: string }[];
}

/** DOM bridge (CSP-safe) for allowlist */
const ALLOW_META_ID = '__PII_ALLOW_META__';
const ALLOW_EVT     = '__PII_ALLOW_CHANGED__';

const makeId = () => Math.random().toString(36).slice(2, 8);
const makeToken = (kind: PiiKind, id: string) => `[${kind}_${id}]`;

// ── Debug helpers ────────────────────────────────────────────────────────────
declare global {
  interface Window { __PII_DEBUG?: boolean }
}
const TAG = 'PII/watchers';
const DEBUG = () => Boolean((window as any).__PII_DEBUG);
const log   = (...a: any[]) => DEBUG() && console.log(`%c${TAG}`, 'color:#2563eb', ...a);
const info  = (...a: any[]) => DEBUG() && console.info(`%c${TAG}`, 'color:#10b981', ...a);
const warn  = (...a: any[]) => DEBUG() && console.warn(`%c${TAG}`, 'color:#f59e0b', ...a);
const err   = (...a: any[]) => DEBUG() && console.error(`%c${TAG}`, 'color:#ef4444', ...a);

function enc(s: string) { return btoa(unescape(encodeURIComponent(s))); }
function dec(s: string) { return decodeURIComponent(escape(atob(s))); }

/** map server label → PiiKind */
function labelToKind(lbl: string): PiiKind | null {
  const up = lbl.toUpperCase();
  if (['EMAIL','E-MAIL','MAIL'].includes(up)) return 'EMAIL';
  if (['PHONE','TEL','MOBILE','CONTACT'].includes(up)) return 'PHONE';
  if (['CREDIT_CARD','CARD','CC'].includes(up)) return 'CREDIT_CARD';
  if (['NRIC','SSN','ID'].includes(up)) return 'NRIC';
  if (['ADDRESS','ADDR','LOCATION'].includes(up)) return 'ADDRESS';
  if (['IP','IPV4','IPV6'].includes(up)) return 'IP';
  if (['NAME','PERSON','PER'].includes(up)) return 'NAME';
  if (['DOB','DATE_OF_BIRTH','BIRTHDATE'].includes(up)) return 'DOB';
  return null;
}

export class DOMWatchers {
  private hud: HTMLElement | null = null;
  private modal: HTMLElement | null = null;

  private editors = new WeakMap<Element, EditorCtx>();
  private policy: Policy | null = null;
  private host: string | null = null;

  // Debounce & IME guards
  private seq = 0;
  private debounceTimer?: number;
  private debounceMs = 300;
  private composing = false;

  // HUD linger
  private hudLingerTimer?: number;
  private hudLingerMs = 4000;

  // Long-lived token map to survive debounce races: token -> original
  private tokenMap = new Map<string, string>();

  // MutationObserver for dynamic editors
  private mo: MutationObserver | null = null;

  // Prevent blur→sanitize when clicking an Undo chip
  private suppressNextBlur = false;

  // Ignore sanitize on programmatic `.value` updates we trigger ourselves
  private internalEdit = false;

  constructor(host: string | null) { this.host = host; }

  async init() {
    info('Initializing DOMWatchers', { host: this.host });
    this.policy = await loadPolicy();
    log('Policy loaded', this.policy);

    if (!isHostEnabled(this.policy, this.host)) {
      warn('Host not enabled by policy; DOMWatchers inactive', { host: this.host });
      return;
    }

    this.installHUD();
    this.installModal();
    this.scanEditors();

    this.mo = new MutationObserver((muts) => {
      DEBUG() && log('MutationObserver tick', { added: muts.reduce((n, m) => n + m.addedNodes.length, 0) });
      this.scanEditors();
    });
    this.mo.observe(document.documentElement, { subtree: true, childList: true });
    window.addEventListener('beforeunload', () => this.destroy(), { once: true });

    info('DOMWatchers ready');
  }

  destroy() {
    info('Destroying DOMWatchers');
    this.mo?.disconnect();
    this.mo = null;
    clearTimeout(this.debounceTimer);
    clearTimeout(this.hudLingerTimer);
    if (this.hud?.isConnected) this.hud.remove();
    if (this.modal?.isConnected) this.modal.remove();
    this.hud = null;
    this.modal = null;
  }

  // ── Allowlist (CSP-safe via <meta> + CustomEvent) ──────────────────────────

  private getAllowlist(): string[] {
    const meta = document.getElementById(ALLOW_META_ID) as HTMLMetaElement | null;
    const encoded = meta?.getAttribute('data-allow');
    if (!encoded) return (window as any).__PII_ALLOWLIST ?? [];
    try { return JSON.parse(dec(encoded)); } catch { return []; }
  }

  private setAllowlist(values: string[]) {
    let meta = document.getElementById(ALLOW_META_ID) as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.id = ALLOW_META_ID;
      document.documentElement.appendChild(meta);
    }
    const encoded = enc(JSON.stringify(values));
    meta.setAttribute('data-allow', encoded);
    (window as any).__PII_ALLOWLIST = values;
    document.documentElement.dispatchEvent(new CustomEvent(ALLOW_EVT, { detail: encoded }));
    log('Allowlist updated', { count: values.length });
  }

  private normalizeForAllowlist(kind: PiiKind, v: string): string {
    switch (kind) {
      case 'EMAIL':        return v.trim().toLowerCase();
      case 'PHONE':
      case 'CREDIT_CARD':  return v.replace(/\D/g, '');
      case 'NRIC':         return v.trim().toUpperCase();
      case 'NAME':         return v.trim().replace(/\s+/g, ' ');
      case 'ADDRESS':      return v.trim().toLowerCase().replace(/\s+/g, ' ');
      case 'IP':           return v.trim();
      default:             return v.trim();
    }
  }
  private makeAllowKey(kind: PiiKind, value: string): string {
    return `${kind}:${this.normalizeForAllowlist(kind, value)}`;
  }
  private addToAllowlist(kind: PiiKind, rawValue: string) {
    const raw = rawValue;
    const key = this.makeAllowKey(kind, rawValue);
    const current = this.getAllowlist();
    const next = Array.from(new Set([...current, raw, key]));
    this.setAllowlist(next);
    log('Added to allowlist', { kind, raw, key });
  }

  // ── HUD UI ─────────────────────────────────────────────────────────────────

  private installHUD() {
    this.hud = document.createElement('div');
    this.hud.className = 'pii-hud';
    document.documentElement.appendChild(this.hud);
    log('HUD installed');
  }

  private renderHUD(ctx: EditorCtx, userInitiated = false) {
    if (!this.hud) return;

    if (ctx.lastRedactions.length === 0) {
      clearTimeout(this.hudLingerTimer);
      if (userInitiated) {
        this.hud.innerHTML = '';
      } else if (this.hud.childElementCount > 0) {
        this.hudLingerTimer = window.setTimeout(() => {
          if (this.hud) this.hud.innerHTML = '';
        }, this.hudLingerMs);
      }
      return;
    }

    clearTimeout(this.hudLingerTimer);
    this.hud.innerHTML = '';

    for (const r of ctx.lastRedactions) {
      const original = ctx.lastMap[r.id] ?? this.tokenMap.get(r.id) ?? r.value;

      const chip = document.createElement('div');
      chip.className = 'pii-chip';
      chip.dataset.id = r.id;
      chip.dataset.kind = r.kind;
      chip.dataset.original = original;
      chip.title = `Redacted: ${r.kind}`;
      chip.innerHTML = `<span class="icon">⚠️</span><span>${r.kind}</span><button type="button">undo</button>`;

      const blockFocusSteal = (e: Event) => e.preventDefault();
      chip.addEventListener('pointerdown', blockFocusSteal);
      chip.addEventListener('mousedown', blockFocusSteal);

      chip.querySelector('button')!.addEventListener('click', () => {
        const id = chip.dataset.id!;
        const kind = chip.dataset.kind as PiiKind;
        const orig = chip.dataset.original || '';

        this.suppressNextBlur = true;
        this.replaceTokenInEditor(ctx.el, id, orig);
        ctx.lastRedactions = ctx.lastRedactions.filter(x => x.id !== id);
        this.addToAllowlist(kind, orig);
        chip.remove();
        this.renderHUD(ctx, /*userInitiated*/ true);
        info('Undo chip clicked', { kind, id });
      });

      this.hud.appendChild(chip);
    }

    log('HUD rendered', { chips: ctx.lastRedactions.length });
  }

  // ── Modal UI ───────────────────────────────────────────────────────────────

  private installModal() {
  if (this.modal) return;
  const m = document.createElement('div');
  m.className = 'pii-modal';
  m.innerHTML = `
    <div class="pii-modal__backdrop" aria-hidden="true"></div>
    <div class="pii-modal__card" role="dialog" aria-modal="true" aria-label="PII detected" tabindex="-1">
      <header class="pii-modal__header">
        <div class="pii-modal__icon" aria-hidden="true">⚠️</div>
        <div class="pii-modal__titles">
          <h3 class="pii-modal__title">Sensitive info detected</h3>
          <p class="pii-modal__subtitle">Review and choose what to redact before sending.</p>
        </div>
        <button type="button" class="pii-modal__x" data-act="cancel" aria-label="Close">✕</button>
      </header>

      <div class="pii-modal__body">
        <div class="pii-modal__list" aria-live="polite"></div>
        <label class="pii-modal__opt">
          <input type="checkbox" data-opt="allow">
          Always allow selected kinds for this site
        </label>
      </div>

      <footer class="pii-modal__actions">
        <button type="button" data-act="cancel" class="btn btn-secondary">Cancel (Esc)</button>
        <button type="button" data-act="redact" class="btn btn-primary">Redact (⌘/Ctrl+Enter)</button>
      </footer>
    </div>
  `;
  document.documentElement.appendChild(m);
    this.modal = m;
    // Close handlers
    const close = () => { this.hideModal(); log('Modal cancelled/dismissed'); };
    m.querySelector('[data-act="cancel"]')!.addEventListener('click', close);
    m.querySelector('.pii-modal__backdrop')!.addEventListener('click', close);

    // Keyboard: Esc to cancel, ⌘/Ctrl+Enter to redact
    m.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const redactBtn = m.querySelector('[data-act="redact"]') as HTMLButtonElement | null;
        if (redactBtn) { e.preventDefault(); redactBtn.click(); }
      }
    });

    log('Modal installed');
  }

  private hideModal() {
    if (!this.modal) return;
    this.modal.classList.remove('is-open');
    const list = this.modal.querySelector('.pii-modal__list')!;
    list.innerHTML = '';
    (this.modal.querySelector('[data-opt="allow"]') as HTMLInputElement).checked = false;
  }

//   private openModal(groups: Map<PiiKind, NerEntity[]>, onRedact: () => void) {
//   if (!this.modal) this.installModal();
//   if (!this.modal) return;

//   const list = this.modal.querySelector('.pii-modal__list')!;
//   list.innerHTML = '';

//   for (const [kind, ents] of groups) {
//     const section = document.createElement('section');
//     section.className = 'pii-modal__group';
//     section.innerHTML = `
//       <div class="pii-modal__groupHead">
//         <span class="pii-badge" data-kind="${kind}">${kind}</span>
//         <span class="pii-count">${ents.length}</span>
//       </div>
//     `;
//     const ul = document.createElement('ul');
//     ul.className = 'pii-modal__items';
//     for (const e of ents) {
//       const li = document.createElement('li');
//       li.className = 'pii-item';
//       li.textContent = e.text;
//       ul.appendChild(li);
//     }
//     section.appendChild(ul);
//     list.appendChild(section);
//   }

//   this.modal.classList.add('is-open');

//   const redactBtn = this.modal.querySelector('[data-act="redact"]') as HTMLButtonElement;
//   const onClick = () => {
//     redactBtn.removeEventListener('click', onClick);
//     this.hideModal();
//     onRedact();
//   };
//   redactBtn.addEventListener('click', onClick);

//   // Focus trap + autofocus
//   const card = this.modal.querySelector('.pii-modal__card') as HTMLElement;
//   card.focus();
//   const focusables = card.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
//   const first = focusables[0], last = focusables[focusables.length - 1];
//   card.addEventListener('keydown', (e: KeyboardEvent) => {
//     if (e.key !== 'Tab' || focusables.length === 0) return;
//     if (e.shiftKey && document.activeElement === first) { e.preventDefault(); (last as HTMLElement).focus(); }
//     else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); (first as HTMLElement).focus(); }
//   });
// }
// NEW signature: pass the raw items array in so we can render checkboxes
private openModalWithSelect(
  items: { ent: NerEntity; kind: PiiKind }[],
  onConfirm: (selected: { ent: NerEntity; kind: PiiKind }[]) => void
) {
  if (!this.modal) this.installModal();
  if (!this.modal) return;

  // group by kind
  const byKind = new Map<PiiKind, Array<{ ent: NerEntity; kind: PiiKind; idx: number }>>();
  items.forEach((it, idx) => {
    const arr = byKind.get(it.kind) || [];
    arr.push({ ...it, idx });
    byKind.set(it.kind, arr);
  });

  const list = this.modal.querySelector('.pii-modal__list')!;
  list.innerHTML = '';

  // Global select row
  const globalBar = document.createElement('div');
  globalBar.className = 'pii-globalSelect';
  globalBar.innerHTML = `
    <button type="button" class="pii-sel-all">Select all</button>
    <button type="button" class="pii-sel-none">Select none</button>
  `;
  list.appendChild(globalBar);

  // Groups
  for (const [kind, ents] of byKind) {
    const section = document.createElement('section');
    section.className = 'pii-modal__group';
    section.innerHTML = `
      <div class="pii-modal__groupHead">
        <label class="pii-badge" data-kind="${kind}">
          <input type="checkbox" class="pii-group-toggle" checked />
          ${kind}
        </label>
        <span class="pii-count">${ents.length}</span>
      </div>
    `;

    const ul = document.createElement('ul');
    ul.className = 'pii-modal__items';
    for (const row of ents) {
      const li = document.createElement('li');
      li.className = 'pii-item';
      li.innerHTML = `
        <label class="pii-item-row">
          <input type="checkbox" class="pii-item-ck" data-idx="${row.idx}" checked />
          <span class="pii-item-text">${row.ent.text}</span>
        </label>
      `;
      ul.appendChild(li);
    }
    section.appendChild(ul);
    list.appendChild(section);

    // group toggle behavior
    const groupToggle = section.querySelector<HTMLInputElement>('.pii-group-toggle')!;
    groupToggle.addEventListener('change', () => {
      section.querySelectorAll<HTMLInputElement>('.pii-item-ck')
        .forEach(ck => { ck.checked = groupToggle.checked; });
    });
  }

  // global select buttons
  (list.querySelector('.pii-sel-all') as HTMLButtonElement).addEventListener('click', () => {
    list.querySelectorAll<HTMLInputElement>('.pii-item-ck').forEach(ck => { ck.checked = true; });
    list.querySelectorAll<HTMLInputElement>('.pii-group-toggle').forEach(ck => { ck.checked = true; });
  });
  (list.querySelector('.pii-sel-none') as HTMLButtonElement).addEventListener('click', () => {
    list.querySelectorAll<HTMLInputElement>('.pii-item-ck').forEach(ck => { ck.checked = false; });
    list.querySelectorAll<HTMLInputElement>('.pii-group-toggle').forEach(ck => { ck.checked = false; });
  });

  this.modal.classList.add('is-open');

  // Confirm handler
  const redactBtn = this.modal.querySelector('[data-act="redact"]') as HTMLButtonElement;
  const onClick = () => {
    redactBtn.removeEventListener('click', onClick);

    const selectedIdx = Array.from(this.modal!.querySelectorAll<HTMLInputElement>('.pii-item-ck'))
      .filter(ck => ck.checked)
      .map(ck => Number(ck.dataset.idx));

    const selected = selectedIdx.map(i => items[i]);
    this.hideModal();
    onConfirm(selected);
  };
  redactBtn.addEventListener('click', onClick);

  // Focus trap + autofocus (same as your current code)
  const card = this.modal.querySelector('.pii-modal__card') as HTMLElement;
  card.focus();
  const focusables = card.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const first = focusables[0], last = focusables[focusables.length - 1];
  card.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || focusables.length === 0) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); (last as HTMLElement).focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); (first as HTMLElement).focus(); }
  });
}

  // ── Editor wiring ──────────────────────────────────────────────────────────

  private attachEditor(el: HTMLElement) {
    if (this.editors.has(el)) return;

    const ctx: EditorCtx = { el, lastMap: {}, lastRedactions: [] };
    this.editors.set(el, ctx);
    DEBUG() && log('Editor attached', el);

    el.addEventListener('compositionstart', () => { this.composing = true; log('IME compositionstart'); });
    el.addEventListener('compositionend',   () => { this.composing = false; log('IME compositionend'); this.scheduleDetect(el, ctx); });

    el.addEventListener('input', () => {
      if (this.internalEdit) return;
      if (this.composing) return;
      this.scheduleDetect(el, ctx);
    });

    el.addEventListener('paste', () => { log('paste event'); this.detectAndPrompt(el, ctx); });
    el.addEventListener('blur',  () => {
      if (this.suppressNextBlur) { this.suppressNextBlur = false; return; }
      log('blur event -> detect');
      this.detectAndPrompt(el, ctx);
    });

    el.addEventListener('keydown', (e: KeyboardEvent) => {
      const isEnter = e.key === 'Enter' && !e.shiftKey;
      const maybeSend = isEnter && (e.metaKey || e.ctrlKey || !e.isComposing);
      if (maybeSend) { log('Enter/send -> detect'); this.detectAndPrompt(el, ctx); }
    });
  }

  private scheduleDetect(el: HTMLElement, ctx: EditorCtx) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => this.detectAndPrompt(el, ctx), this.debounceMs);
    DEBUG() && log('debounce scheduled', { ms: this.debounceMs });
  }

  private async detectAndPrompt(el: HTMLElement, ctx: EditorCtx) {
    const t0 = performance.now();
    const mySeq = ++this.seq;
    const text = this.getText(el);
    if (!text.trim()) return;

    if (!this.policy) this.policy = await loadPolicy();
    if (!this.policy.useNerApi) {
      log('NER API disabled by policy');
      return;
    }

    let resp: { entities: NerEntity[] };
    try {
      log('Calling NER API', { url: this.policy.nerApiUrl, len: text.length, seq: mySeq });
      resp = await callRedactApi(text, this.policy.nerApiUrl!);
    } catch (e) {
      err('NER API call failed', e);
      return;
    }
    if (mySeq !== this.seq) {
      warn('Stale detect result discarded', { mySeq, seq: this.seq });
      return;
    }

    const allow = this.getAllowlist();
    const items = resp.entities
      .map(ent => ({ ent, kind: labelToKind(ent.label) }))
      .filter((x): x is { ent: NerEntity; kind: PiiKind } => !!x.kind)
      .filter(x => isKindBlocked(this.policy!, x.kind))
      .filter(({ ent, kind }) => {
        const key = this.makeAllowKey(kind, ent.text);
        return !allow.includes(key) && !allow.includes(ent.text.trim());
      });

    const dt = Math.round(performance.now() - t0);
    log('Detect complete', {
      seq: mySeq,
      found: resp.entities.length,
      actionable: items.length,
      allowlistCount: allow.length,
      timeMs: dt
    });

    if (items.length === 0) return;

    const groups = new Map<PiiKind, NerEntity[]>();
    for (const { ent, kind } of items) {
      const arr = groups.get(kind) || [];
      arr.push(ent);
      groups.set(kind, arr);
    }

   this.openModalWithSelect(items, (selected) => {
    if (!selected.length) { info('No items selected for redaction'); return; }
    const allowChecked = (this.modal!.querySelector('[data-opt="allow"]') as HTMLInputElement).checked;
    this.applyRedactions(el, ctx, selected, allowChecked);
  });
  }
private applyRedactions(
  el: HTMLElement,
  ctx: EditorCtx,
  items: { ent: NerEntity; kind: PiiKind }[],
  persistAllow: boolean
) {
  // sort from highest word index to lowest to keep indices stable
  const sorted = [...items].sort((a, b) => b.ent.index - a.ent.index);
  let text = this.getText(el);
  
  // split text into words to work with word indices
  const words = text.split(/(\s+)/); // keep whitespace as separate elements
  const wordIndices = words.filter((_, i) => i % 2 === 0); // get only word elements (skip whitespace)

  const redactions: { id: string; kind: string; value: string }[] = [];
  const map: Record<string, string> = {};

  for (const { ent, kind } of sorted) {
    const id = makeId();
    const token = makeToken(kind, id);        // e.g. [EMAIL_91kdj]

    // replace the word at the specified index
    if (ent.index >= 0 && ent.index < wordIndices.length) {
      const wordIndex = ent.index * 2; // account for whitespace elements
      if (wordIndex < words.length) {
        words[wordIndex] = token;
      }
    }

    // use the full visible token as the lookup key for undo
    map[token] = ent.text;
    redactions.push({ id: token, kind, value: ent.text });

    if (persistAllow) this.addToAllowlist(kind, ent.text);
  }

  // reconstruct text from modified words array
  text = words.join('');

  // persist for debounce races
  for (const [t, v] of Object.entries(map)) this.tokenMap.set(t, v);

  ctx.lastMap = map;
  ctx.lastRedactions = redactions;

  this.setText(el, text);
  this.renderHUD(ctx, /*userInitiated*/ true);
  info('Applied redactions', { count: redactions.length, persistAllow });
}


  // ── Text helpers (caret-safe) ──────────────────────────────────────────────

private replaceTokenInEditor(el: HTMLElement, token: string, original: string) {
  const text = this.getText(el);
  const i = text.indexOf(token);
  if (i < 0) return;

  const before = text.slice(0, i);
  const after  = text.slice(i + token.length);
  const next   = before + original + after;

  (el as any).focus?.({ preventScroll: true });
  this.setText(el, next);
  info('Token restored via chip undo');

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const pos = before.length + original.length;
    try { (el as HTMLTextAreaElement).setSelectionRange(pos, pos); } catch {}
  } else if ((el as any).isContentEditable) {
    try {
      const range = document.createRange();
      const sel = window.getSelection?.();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {}
  }
}

  private getText(el: HTMLElement): string {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return (el as HTMLInputElement).value ?? '';
    }
    return el.textContent ?? '';
  }

  private setText(el: HTMLElement, v: string) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const t = el as HTMLTextAreaElement;
      const hadFocus = document.activeElement === t;

      const oldVal = t.value ?? '';
      const oldLen = oldVal.length;
      let start = (t as any).selectionStart ?? oldLen;
      let end   = (t as any).selectionEnd   ?? oldLen;
      const wasAtEnd = start === oldLen && end === oldLen;
      const oldScroll = (t as any).scrollTop ?? 0;

      this.internalEdit = true;
      if (!hadFocus) t.focus?.({ preventScroll: true });
      (t as any).value = v;

      requestAnimationFrame(() => {
        const newLen = v.length;
        try {
          if (wasAtEnd) {
            t.setSelectionRange(newLen, newLen);
          } else {
            start = Math.min(start, newLen);
            end   = Math.min(end,   newLen);
            t.setSelectionRange(start, end);
          }
        } catch {}
        try { (t as any).scrollTop = oldScroll; } catch {}
        this.internalEdit = false;
      });

    } else if ((el as any).isContentEditable) {
      el.textContent = v;
    } else {
      el.textContent = v;
    }
  }

  // ── Scanning ───────────────────────────────────────────────────────────────

  private scanEditors() {
    const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')) as HTMLInputElement[];
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];

    let attached = 0;
    for (const el of [...textareas, ...inputs, ...editables]) {
      if (!this.editors.has(el)) {
        this.attachEditor(el as any);
        attached++;
      }
    }
    if (attached) log('Editors scanned/attached', { added: attached, totals: {
      textareas: textareas.length, inputs: inputs.length, editables: editables.length
    }});
  }
}
