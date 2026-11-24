import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/business-cloud-portal/",
  build: {
    target: "es2020",
    sourcemap: false, // smaller deploy, nothing extra to download
    chunkSizeWarningLimit: 800,
  },
});
