import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {routePagesPlugin} from "./scripts/route-pages.mjs";

export default defineConfig({
  plugins: [react(), routePagesPlugin()],
});
