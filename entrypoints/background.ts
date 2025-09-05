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

// --- Sites flagged counter ---
const incrementFlaggedCounter = async () => {
  const result = await safeGet("sitesFlagged");
  const count = (result.sitesFlagged || 0) + 1;
  await safeSet({ sitesFlagged: count });
  return count;
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
  const removeIds = rules
    .filter(r => r.condition.urlFilter === host)
    .map(r => r.id);

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

  // --- Instant re-block using cached hostnames ---
  const cache = await getMaliciousCache(); 
  const isMalicious = Array.from(cache).some((cachedUrl) => {
    try {
      return new URL(cachedUrl).hostname === host;
    } catch {
      return false;
    }
  });

  if (isMalicious) {
    const ruleId = await addBlockingRule(fullUrl);
    console.log(`[Background] Re-blocked ${fullUrl} immediately after removal`);

    // Redirect any open tabs for this host
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
      await incrementFlaggedCounter();
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

        // --- Auto-redirect tab if warning page triggered ---
        if (sender.tab?.id) {
          chrome.tabs.update(sender.tab.id, { url: msg.url });
        }
      }

      // --- Get flagged sites counter ---
      if (msg.action === "get-flagged-count") { 
        const result = await safeGet("sitesFlagged");
        sendResponse(result.sitesFlagged || 0); 
      }

      // --- Remove URL from permanent allowlist ---
      if (msg.action === "remove-url" && msg.url) {
        await removeFromAllowlist(msg.url);
        const updated = Array.from(await getAllowlist());
        sendResponse(updated);
      }

      // --- Fetch permanent allowlist ---
      if (msg.action === "get-allowlist") {
        const updated = Array.from(await getAllowlist());
        sendResponse(updated);
      }

      // --- Temporary allowlist ---
      if (msg.action === "get-temp-allowlist") {
        sendResponse(Array.from(tempAllowlist));
      }

      if (msg.action === "proceed-temp" && msg.url && sender.tab?.id) {
        let fullUrl = msg.url;
        if (!/^https?:\/\//i.test(msg.url)) fullUrl = "https://" + msg.url;

        try {
          const host = new URL(fullUrl).hostname;
          const permanent = await getAllowlist();

          if (!permanent.has(host)) {
            tempAllowlist.add(host);
            console.log(`[Background] Added to temporary allowlist: ${host}`);
          }

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

          chrome.tabs.update(sender.tab.id, { url: fullUrl });
          sendResponse({ ok: true });

        } catch (err) {
          console.error("[Background] proceed-temp failed:", err);
          sendResponse({ ok: false });
        }
      }

      if (msg.action === "remove-temp-url" && msg.url) {
        try {
          let fullUrl = msg.url;
          if (!/^https?:\/\//i.test(fullUrl)) fullUrl = "https://" + fullUrl;

          const host = new URL(fullUrl).hostname;
          tempAllowlist.delete(host);
          console.log(`[Background] Removed from temporary allowlist: ${host}`);

          const rules = await chrome.declarativeNetRequest.getDynamicRules();
          const removeIds = rules.filter(r => r.condition.urlFilter === host).map(r => r.id);

          if (removeIds.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules: [] });
            console.log(`[Background] Removed dynamic rules for ${host}`);
          }

          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.url && tab.id) {
                try {
                  const tabHost = new URL(tab.url).hostname;
                  if (tabHost === host) chrome.tabs.reload(tab.id);
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

      if (msg.action === "checkBreach" && msg.email) {
        const result = await checkEmailForBreach(msg.email);
        sendResponse(result);
      }

    };

    handle();
    return true; // keep async response open
  });
});


async function checkEmailForBreach(email: string) {
  try {
    const apiUrl = `https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`;
    
    // Use the browser's built-in fetch API to make the request
    const response = await fetch(apiUrl);

    // If the email is not found, the API returns a 404 status
    if (response.status === 404) {
      const errorData = await response.json();
      if (errorData.Error === "Not found") {
        return { breaches: [], message: 'No breaches found.' };
      }
    }

    if (!response.ok) {
      // Handle other potential errors like server issues
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error('Failed to check for breaches:', error);
    // Return an error object so the frontend knows something went wrong
    return { error: 'Failed to fetch breach data.' };
  }
}

(self as any).checkEmailForBreach = checkEmailForBreach;
