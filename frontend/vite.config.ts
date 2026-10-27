import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, /api is proxied to the backend so the browser makes same-origin requests.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": process.env.BACKEND_URL ?? "http://127.0.0.1:8000",
    },
  },
});
