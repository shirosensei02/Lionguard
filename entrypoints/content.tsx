// src/content/content.ts
import { api, getCurrentHost } from './core/browserApi';
// If THIS file is src/content/content.ts, import like this:
import { DOMWatchers } from './content/domWatchers';
// If THIS file is NOT in src/content/, but e.g. at project root, use:
// import { DOMWatchers } from './content/domWatchers';

import { loadPolicy, isHostEnabled, type Policy } from './core/policy';
import './content/hud.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const POLICY_META_ID = '__PII_POLICY_META__' as const;
const POLICY_EVT     = '__PII_POLICY_CHANGED__' as const;

// ── Debug helpers ────────────────────────────────────────────────────────────
declare global {
  interface Window { __PII_DEBUG?: boolean }
}

const TAG = 'PII/content';
const DEBUG = () => Boolean((window as any).__PII_DEBUG);
const log   = (...a: unknown[]) => DEBUG() && console.log(`%c${TAG}`, 'color:#2563eb', ...a);
const info  = (...a: unknown[]) => DEBUG() && console.info(`%c${TAG}`, 'color:#10b981', ...a);
const warn  = (...a: unknown[]) => DEBUG() && console.warn(`%c${TAG}`, 'color:#f59e0b', ...a);
const err   = (...a: unknown[]) => DEBUG() && console.error(`%c${TAG}`, 'color:#ef4444', ...a);

// Avoid deprecated unescape; keep a safe UTF-8 → b64 for page-world bridge.
function safeB64Encode(str: string): string {
  // In extension/content contexts, btoa exists. Encode UTF-8 properly:
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  ));
}

function publishPolicyToPage(policy: Policy) {
  const json = JSON.stringify(policy);

  let meta = document.getElementById(POLICY_META_ID) as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.id = POLICY_META_ID;
    document.documentElement.appendChild(meta);
    log('Created policy meta bridge');
  }

  const encoded = safeB64Encode(json);
  meta.setAttribute('data-policy', encoded);

  // Type detail as string because we pass the encoded policy in detail.
  const evt: CustomEvent<string> = new CustomEvent(POLICY_EVT, { detail: encoded });
  document.documentElement.dispatchEvent(evt);

  log('Published policy to page world', {
    enabled: policy.enabled,
    targets: policy.targetHosts,
  });
}

// If you're using WXT, defineContentScript is globally available.
// Otherwise, import it: import { defineContentScript } from 'wxt/client';
export default defineContentScript({
  matches: ['*://*/*'],

  // ⚠️ MUST be async if you use await inside.
  async main() {
    try {
      console.log("running main");
      const host = getCurrentHost();
      (window as any).__PII_DEBUG ??= true; // default off; toggle in console
      info('Booting content', { host });

      const watchers = new DOMWatchers(host);
      let watchersActive = false;

      let policy: Policy = await loadPolicy();
      log('Loaded policy', policy);
      publishPolicyToPage(policy);

      const syncWatchersToPolicy = (p: Policy) => {
        const enabled = isHostEnabled(p, host);

        if (!enabled) {
          // Keep a console.warn for quick visibility when debugging
          console.warn('PII/content: Host not enabled by policy', {
            host,
            targetHosts: p.targetHosts,
            perSite: p.perSite,
          });
        }

        log('Sync watchers to policy', { host, enabled });

        if (enabled && !watchersActive) {
          info('Starting DOMWatchers');
          watchers.init();
          watchersActive = true;
        } else if (!enabled && watchersActive) {
          // watchers.destroy?.(); // optional: stop if you want to fully detach
          warn('DOMWatchers would be stopped (kept alive by design)');
          watchersActive = false;
        }
      };

      syncWatchersToPolicy(policy);

      // ── Storage changes ────────────────────────────────────────────────────
      // Type signature here keeps TS happy and guards against unrelated sync changes.
      api.storage.onChanged.addListener(
        (
          changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
          area: string
        ) => {
          if (area !== 'sync') return;
          const change = (changes as any)['pii_policy_v1'];
          if (!change || change.newValue == null) return;

          policy = change.newValue as Policy;
          info('Storage change detected; updating policy');
          publishPolicyToPage(policy);
          syncWatchersToPolicy(policy);
        }
      );

      // ── Runtime messages ───────────────────────────────────────────────────
      // Chrome type: (message, sender, sendResponse) => boolean | void
      api.runtime.onMessage.addListener(
        (msg: unknown /*, _sender, _sendResponse */) => {
          const m = msg as { type?: string; policy?: Policy };
          if (m?.type === 'policy-updated' && m.policy) {
            info('Runtime message: policy-updated');
            policy = m.policy;
            publishPolicyToPage(policy);
            syncWatchersToPolicy(policy);
          }
          // Return false (no async response), keeps listener type-safe across MV3
          return false;
        }
      );
    } catch (e) {
      err('Fatal error in content bootstrap', e);
    }
  },
});
