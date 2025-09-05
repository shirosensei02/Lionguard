const API_KEY = import.meta.env.VITE_API_KEY;

if (!API_KEY) {
  console.warn("[Background] VITE_API_KEY missing. URL scanning is disabled.");
}

// --- Storage Helpers ---
const safeGet = async (key: string) => {
  if (!chrome?.storage?.local) return {};
  try {
    return await chrome.storage.local.get(key);
  } catch (err) {
    console.warn(`[Background] Failed to get ${key}:`, err);
    return {};
  }
};

const safeSet = async (obj: Record<string, any>) => {
  if (!chrome?.storage?.local) return;
  try {
    await chrome.storage.local.set(obj);
  } catch (err) {
    console.warn(`[Background] Failed to set storage:`, err);
  }
};

// --- Allowlist Helpers (Permanent) ---
const getAllowlist = async (): Promise<Set<string>> => {
  const result = await safeGet("allowlist");
  return new Set(result.allowlist || []);
};

const addToAllowlist = async (url: string) => {
  let fullUrl = url;
  if (!/^https?:\/\//i.test(url)) fullUrl = "https://" + url;

  let host: string;
  try {
    host = new URL(fullUrl).hostname;
  } catch (err) {
    console.error("[Background] Invalid URL passed to addToAllowlist:", url);
    return;
  }

  const allowlist = await getAllowlist();
  allowlist.add(host);
  await safeSet({ allowlist: Array.from(allowlist) });
  console.log(`[Background] Added to permanent allowlist: ${host}`);

  // Remove any dynamic blocking rules for this host
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = rules.filter(r => r.condition.urlFilter === host).map(r => r.id);
  if (removeIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules: [] });
  }

  // Remove from temporary allowlist if exists
  tempAllowlist.delete(host);
};

const removeFromAllowlist = async (url: string) => {
  let fullUrl = url;
  if (!/^https?:\/\//i.test(url)) fullUrl = "https://" + url;

  let host: string;
  try {
    host = new URL(fullUrl).hostname;
  } catch (err) {
    console.error("[Background] Invalid URL passed to removeFromAllowlist:", url);
    return;
  }

  const allowlist = await getAllowlist();
  allowlist.delete(host);
  await safeSet({ allowlist: Array.from(allowlist) });
  console.log(`[Background] Removed from permanent allowlist: ${host}`);

  // Re-block if malicious
  try {
    const malicious = await isMalicious(fullUrl);
    if (malicious) {
      const ruleId = await addBlockingRule(fullUrl);
      console.log(`[Background] Re-blocked ${fullUrl} after removal`);

      // Redirect any open tabs for this host to the warning page
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.url && tab.id) {
            try {
              const tabHost = new URL(tab.url).hostname;
              if (tabHost === host) {
                chrome.tabs.update(tab.id, {
                  url: `/warning.html?maliciousUrl=${encodeURIComponent(fullUrl)}&ruleId=${ruleId}`,
                });
              }
            } catch {}
          }
        });
      });
    }
  } catch (err) {
    console.warn("[Background] Could not re-block site:", fullUrl, err);
  }
};

// --- Temporary Allowlist (Session-only) ---
const tempAllowlist = new Set<string>();

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
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "x-apikey": API_KEY,
      },
      body: formData.toString(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.id || null;
  } catch {
    return null;
  }
};

const getAnalysis = async (analysisId: string): Promise<boolean> => {
  if (!API_KEY) return false;
  try {
    const res = await fetch(
      `https://www.virustotal.com/api/v3/analyses/${analysisId}`,
      { headers: { "x-apikey": API_KEY } }
    );
    if (!res.ok) return false;
    const stats = (await res.json())?.data?.attributes?.stats;
    return stats?.malicious > 0 || false;
  } catch {
    return false;
  }
};

// --- Allowlist Checker ---
async function isAllowed(url: string): Promise<boolean> {
  try {
    const host = new URL(url).hostname;
    const permanent = await getAllowlist();
    if (permanent.has(host)) return true;
    if (tempAllowlist.has(host)) return true;
    return false;
  } catch (err) {
    console.error("isAllowed check failed:", err);
    return false;
  }
}

// --- Malicious Check ---
const isMalicious = async (url: string): Promise<boolean> => {
  if (await isAllowed(url)) {
    console.log(`[Background] ${url} is allowlisted → skipping malicious check`);
    return false;
  }

  const cache = await getMaliciousCache();
  if (cache.has(url)) return true;

  const analysisId = await scanUrl(url);
  if (!analysisId) return false;

  const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));
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
    addRules: [
      {
        id: ruleId,
        priority: 1,
        action: { type: "redirect", redirect: { extensionPath: redirectUrl } },
        condition: { urlFilter: host, resourceTypes: ["main_frame"] },
      },
    ],
    removeRuleIds: [],
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
    if (recentlyChecked.has(tabId)) {
      recentlyChecked.delete(tabId);
      return;
    }

    const malicious = await isMalicious(tab.url);
    if (malicious) {
      await addBlockingRule(tab.url);
      recentlyChecked.add(tabId);
      chrome.tabs.update(tabId, { url: tab.url });
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const handle = async () => {
      // --- Proceed permanent allowlist ---
      if (msg.action === "proceed" && msg.ruleId && sender.tab?.id) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          addRules: [],
          removeRuleIds: [msg.ruleId],
        });
        chrome.tabs.update(sender.tab.id, { url: msg.maliciousUrl });
      }

      // --- Permanent allowlist ---
      if (msg.action === "allowlist" && msg.url) {
        await addToAllowlist(msg.url);
        const updated = Array.from(await getAllowlist());
        sendResponse(updated);
      }

      if (msg.action === "remove-url" && msg.url) {
        await removeFromAllowlist(msg.url);
        const updated = Array.from(await getAllowlist());
        sendResponse(updated);
      }

      if (msg.action === "get-allowlist") {
        const updated = Array.from(await getAllowlist());
        sendResponse(updated);
      }

      // --- Temporary allowlist (minimal changes) ---

      // 1. Fetch temp allowlist for popup
      if (msg.action === "get-temp-allowlist") {
        sendResponse(Array.from(tempAllowlist));
      }

// 2. Add URL to temporary allowlist (proceed-temp)
if (msg.action === "proceed-temp" && msg.url && sender.tab?.id) {
  let fullUrl = msg.url;
  if (!/^https?:\/\//i.test(msg.url)) fullUrl = "https://" + msg.url;

  try {
    const host = new URL(fullUrl).hostname;
    const permanent = await getAllowlist();

    // Only add to temp if not in permanent allowlist
    if (!permanent.has(host)) {
      tempAllowlist.add(host);
      console.log(`[Background] Added to temporary allowlist: ${host}`);
    }

    // --- REMOVE ANY DYNAMIC RULES THAT BLOCK THIS HOST ---
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = rules.filter(r => {
      try {
        const ruleHost = new URL("https://" + r.condition.urlFilter).hostname;
        return ruleHost === host;
      } catch {
        return false;
      }
    }).map(r => r.id);

    if (removeIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules: [] });
      console.log(`[Background] Removed dynamic rules for host: ${host}`);
    }

    // Navigate the tab
    chrome.tabs.update(sender.tab.id, { url: fullUrl });
    sendResponse({ ok: true });

  } catch (err) {
    console.error("[Background] proceed-temp failed:", err);
    sendResponse({ ok: false });
  }
}

// 3. Remove URL from temporary allowlist
if (msg.action === "remove-temp-url" && msg.url) {
  try {
    let fullUrl = msg.url;
    if (!/^https?:\/\//i.test(fullUrl)) fullUrl = "https://" + fullUrl; // normalize

    const host = new URL(fullUrl).hostname;
    tempAllowlist.delete(host);
    console.log(`[Background] Removed from temporary allowlist: ${host}`);

    // Remove any dynamic blocking rules for this host
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = rules.filter(r => r.condition.urlFilter === host).map(r => r.id);
    if (removeIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules: [] });
      console.log(`[Background] Removed dynamic rules for ${host}`);
    }

    // Refresh all tabs that match this host so they can load
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.url && tab.id) {
          try {
            const tabHost = new URL(tab.url).hostname;
            if (tabHost === host) {
              chrome.tabs.reload(tab.id); // reload the tab
            }
          } catch {}
        }
      });
    });

    sendResponse({ ok: true });
  } catch (err) {
    console.error("[Background] remove-temp-url failed:", err);
    sendResponse({ ok: false });
  }
}



    };

    handle();
    return true; // keep async response open
  });
});

