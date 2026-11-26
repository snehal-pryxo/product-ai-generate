// Bundles the bulk worker (app/worker/index.js) into build/worker/index.js.
// App source uses extensionless imports that Node can't resolve on its own, so
// the worker is bundled like the server build; npm packages stay external and
// resolve from node_modules in the same Docker image.
import { build } from "esbuild";

await build({
  entryPoints: ["app/worker/index.js"],
  outfile: "build/worker/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});
