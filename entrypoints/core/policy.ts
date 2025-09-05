import { storage } from './browserApi';

export type PiiKind =
  | 'EMAIL' | 'PHONE' | 'CREDIT_CARD' | 'NRIC'
  | 'ADDRESS' | 'IP' | 'NAME' | 'DOB';

export interface Policy {
  enabled: boolean;                 // global on/off
  targetHosts: string[];            // sites to auto-enable on
  perSite: Record<string, { enabled: boolean }>; // host -> toggle
  allowKinds: PiiKind[];            // kinds allowed to pass
  blockKinds: PiiKind[];            // kinds to redact (derived if empty -> all except allowKinds)
  localProxy: boolean;              // future: route via localhost proxy for corp
  useNerApi?: boolean;              // use local NER API to detect (default true)
  nerApiUrl?: string;               // NER endpoint (default http://127.0.0.1:8000/redact)
}

export const DEFAULT_POLICY: Policy = {
  enabled: true,
  targetHosts: [
    'chat.openai.com', 'claude.ai', 'gemini.google.com', 'bard.google.com', 'perplexity.ai', 'poe.com', 'chatgpt.com'
  ],
  perSite: {},
  allowKinds: [],
  blockKinds: ['EMAIL','PHONE','CREDIT_CARD','NRIC','ADDRESS','IP','NAME'],
  localProxy: false,
  useNerApi: true,
  nerApiUrl: 'http://127.0.0.1:8000/redact',
};

const KEY = 'pii_policy_v1';

export async function loadPolicy(): Promise<Policy> {
  const data = await storage.get<{[key: string]: Policy}>({ [KEY]: DEFAULT_POLICY } as any);
  const p = (data as any)[KEY] ?? DEFAULT_POLICY;
  if (p.useNerApi === undefined) p.useNerApi = true;
  if (!p.nerApiUrl) p.nerApiUrl = DEFAULT_POLICY.nerApiUrl!;
  return p;
}

export async function savePolicy(p: Policy): Promise<void> {
  await storage.set({ [KEY]: p });
}

export function isHostEnabled(policy: Policy, host: string | null): boolean {
  if (!policy.enabled || !host) return false;
  const site = policy.perSite[host];
  if (site) return site.enabled;
  return policy.targetHosts.includes(host);
}

export function isKindBlocked(policy: Policy, kind: PiiKind): boolean {
  if (policy.allowKinds.includes(kind)) return false;
  if (policy.blockKinds.length === 0) return true;
  return policy.blockKinds.includes(kind);
}
