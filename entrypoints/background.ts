const API_KEY = import.meta.env.VITE_API_KEY;

if (!API_KEY) {
  console.warn("[Background] VITE_API_KEY missing. URL scanning is disabled.");
}

// --- Storage Helpers ---
const safeGet = async (key: string) => {
  if (!chrome?.storage?.local) return {};
  try { return await chrome.storage.local.get(key); }
  catch (err) { console.warn(`[Background] Failed to get ${key}:`, err); return {}; }
};

const safeSet = async (obj: Record<string, any>) => {
  if (!chrome?.storage?.local) return;
  try { await chrome.storage.local.set(obj); }
  catch (err) { console.warn(`[Background] Failed to set storage:`, err); }
};

// --- Allowlist Helpers ---
const getAllowlist = async (): Promise<Set<string>> => {
  const result = await safeGet("allowlist");
  return new Set(result.allowlist || []);
};

const addToAllowlist = async (url: string) => {
  const host = new URL(url).hostname;
  const allowlist = await getAllowlist();
  allowlist.add(host);
  await safeSet({ allowlist: Array.from(allowlist) });
  console.log(`[Background] Added to allowlist (host): ${host}`);
};

// --- Malicious Cache ---
const getMaliciousCache = async (): Promise<Set<string>> => {
  const result = await safeGet("maliciousCache");
  return new Set(result.maliciousCache || []);
};

const addToMaliciousCache = async (url: string) => {
  const cache = await getMaliciousCache();
  cache.add(url);
  await safeSet({ maliciousCache: Array.from(cache) });
};

// --- VirusTotal Helpers ---
const scanUrl = async (url: string): Promise<string | null> => {
  if (!API_KEY) return null;
  try {
    const formData = new URLSearchParams({ url });
    const res = await fetch("https://www.virustotal.com/api/v3/urls", {
      method: "POST",
      headers: { "accept": "application/json", "content-type": "application/x-www-form-urlencoded", "x-apikey": API_KEY },
      body: formData.toString()
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.id || null;
  } catch { return null; }
};

const getAnalysis = async (analysisId: string): Promise<boolean> => {
  if (!API_KEY) return false;
  try {
    const res = await fetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, {
      headers: { "x-apikey": API_KEY }
    });
    if (!res.ok) return false;
    const stats = (await res.json())?.data?.attributes?.stats;
    return stats?.malicious > 0 || false;
  } catch { return false; }
};

const isMalicious = async (url: string): Promise<boolean> => {
  const cache = await getMaliciousCache();
  if (cache.has(url)) return true;
  const analysisId = await scanUrl(url);
  if (!analysisId) return false;
  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
  for (let i = 0; i < 5; i++) {
    const result = await getAnalysis(analysisId);
    if (result !== null) {
      if (result) await addToMaliciousCache(url);
      return result;
    }
    await delay(2000);
  }
  return false;
};

// --- Dynamic Blocking ---
const addBlockingRule = async (url: string) => {
  const host = new URL(url).hostname;
  const ruleId = Math.floor(Math.random() * 1_000_000);
  const redirectUrl = `/warning.html?maliciousUrl=${encodeURIComponent(url)}&ruleId=${ruleId}`;

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{
      id: ruleId,
      priority: 1,
      action: { type: "redirect", redirect: { extensionPath: redirectUrl } },
      condition: { urlFilter: host, resourceTypes: ["main_frame"] }
    }],
    removeRuleIds: []
  });

  return ruleId;
};

// --- Background Listener ---
export default defineBackground(() => {
  console.log("[Background] Extension started");

  const recentlyChecked = new Set<number>();

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "loading" || !tab.url) return;
    if (!/^https?:\/\//.test(tab.url)) return;
    if (recentlyChecked.has(tabId)) { recentlyChecked.delete(tabId); return; }

    const allowlist = await getAllowlist();
    const host = new URL(tab.url).hostname;
    if (allowlist.has(host)) return;

    const malicious = await isMalicious(tab.url);
    if (malicious) {
      await addBlockingRule(tab.url);
      recentlyChecked.add(tabId);
      chrome.tabs.update(tabId, { url: tab.url });
    }
  });

  chrome.runtime.onMessage.addListener(async (msg, sender) => {
    if (msg.action === "proceed" && msg.ruleId && sender.tab?.id) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [],
        removeRuleIds: [msg.ruleId]
      });
      chrome.tabs.update(sender.tab.id, { url: msg.maliciousUrl });
    }

    if (msg.action === "allowlist" && msg.url) {
      await addToAllowlist(msg.url);
    }
  });
});
