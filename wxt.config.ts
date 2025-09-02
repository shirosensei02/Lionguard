import {defineConfig} from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    host_permissions: ["http://127.0.0.1:8000/*", "http://localhost:8000/*"],
  },
  webExt: {
    startUrls: ["http://localhost:3000"],
  },
});
