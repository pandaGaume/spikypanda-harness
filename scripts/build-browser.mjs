import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const core = require.resolve("@spiky-panda/core");
const editor = require.resolve("@spikypanda/nodeeditor");
const common = { bundle: true, sourcemap: true, target: "es2022", logLevel: "info" };

await mkdir(resolve(root, "dist/demo"), { recursive: true });
await build({ ...common, entryPoints: [resolve(root, "examples/editor/app.mjs")], outfile: resolve(root, "dist/demo/app.js"), format: "esm",
    alias: { "spikypanda-core": core, "@spiky-panda/core": core, "reflect-metadata": createRequire(core).resolve("reflect-metadata") },
    plugins: [{ name: "editor-css", setup(builder) {
        builder.onResolve({ filter: /^\.\/styles\/nodeeditor\.css$/ }, args => ({ path: resolve(dirname(editor), "../src/styles/nodeeditor.css") }));
        // The upstream barrel also exports Node-only dataset utilities. They are
        // unused here; fail explicitly if a future browser caller invokes them.
        builder.onResolve({ filter: /^(fs|zlib|https|path)$/ }, args => ({ path: args.path, namespace: "node-only" }));
        builder.onLoad({ filter: /.*/, namespace: "node-only" }, args => ({ contents:
            `module.exports = new Proxy({}, { get() { return () => { throw new Error(${JSON.stringify(`${args.path} is unavailable in the browser`)}); }; } });`, loader: "js" }));
    } }],
});
await copyFile(resolve(root, "examples/editor/index.html"), resolve(root, "dist/demo/index.html"));
await build({ ...common, entryPoints: [resolve(root, "packages/plugin-harness/dist/index.js")],
    outfile: resolve(root, "packages/plugin-harness/bundle/SpkPluginHarness.js"), format: "iife", globalName: "SpkPluginHarness",
    plugins: [{ name: "shared-runtime", setup(builder) {
        builder.onResolve({ filter: /^@spiky-panda\/harness$/ }, () => ({ path: "harness", namespace: "harness-host" }));
        builder.onLoad({ filter: /.*/, namespace: "harness-host" }, () => ({ contents:
            'if (!globalThis.SpikypandaHarness) throw new Error("Load the shared SpikypandaHarness before its visual plugin"); module.exports = globalThis.SpikypandaHarness;', loader: "js" }));
        builder.onResolve({ filter: /^(@spiky-panda\/core|spikypanda-core)$/ }, () => ({ path: "core", namespace: "host" }));
        builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents:
            'if (!globalThis.SpikypandaCore) throw new Error("Load the shared SpikypandaCore before Harness"); module.exports = globalThis.SpikypandaCore;', loader: "js" }));
    } }],
});
await copyFile(resolve(root, "packages/plugin-harness/bundle/SpkPluginHarness.js"), resolve(root, "dist/demo/SpkPluginHarness.js"));
console.log("Browser demo and shared-runtime plugin bundle ready.");
