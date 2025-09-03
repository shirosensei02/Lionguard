import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Lionguard",
    description: "Blocks malicious URLs using an external API + DNR",
    version: "1.0.0",
    manifest_version: 3,
    permissions: [
      "declarativeNetRequest",
      "declarativeNetRequestWithHostAccess",
      "tabs",
      "storage"
    ],
    host_permissions: ["<all_urls>"],
    background: {
      service_worker: "background.js",
      type: "module"
    },
    web_accessible_resources: [
      {
        resources: ["warning.html", "dashboard.html"], // ✅ expose dashboard
        matches: ["<all_urls>"]
      }
    ],
    action: {
      default_popup: "popup.html",
    },
    options_ui: {
      page: "dashboard.html",   // ✅ makes dashboard accessible via chrome://extensions → Details → Extension options
      open_in_tab: true
    }
  },
  webExt: {
    startUrls: ["http://localhost:3000"] // dev server URL for testing
  },
});
