import { readFileSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootPackage = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as {
  version: string;
};

if (!/^\d+$/.test(rootPackage.version)) {
  throw new Error("Root package.json version must be a whole number");
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(rootPackage.version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@feud/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/socket.io": { target: "http://127.0.0.1:3000", ws: true, changeOrigin: true },
    },
  },
});
