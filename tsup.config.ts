import { defineConfig } from "tsup";

export default defineConfig({
  esbuildOptions(options) {
    // Keep generated extension bundles independent of the physical package
    // cache location when node_modules is provided through a junction/symlink.
    options.preserveSymlinks = true;
  },
});
