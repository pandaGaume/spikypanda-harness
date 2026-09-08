import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";

const checkout = resolve(process.argv[2] ?? process.env.SPIKYPANDA_REPO ?? "../../spikypanda");
const dependencies = [
    ["@spiky-panda/core", resolve(checkout, "packages/dev/core")],
    ["@spikypanda/nodeeditor", resolve(checkout, "packages/dev/nodeeditor")],
];

for (const [name, source] of dependencies) {
    const manifest = resolve(source, "package.json");
    if (!existsSync(manifest)) throw new Error(`Missing SpikyPanda package: ${manifest}`);
    const parsed = JSON.parse(readFileSync(manifest, "utf8"));
    if (parsed.name !== name) {
        throw new Error(`Unexpected package at ${source}: ${String(parsed.name)}`);
    }
}

// Check every destination before creating any link.
for (const [name, source] of dependencies) {
    const destination = resolve("node_modules", name);
    if (existsSync(destination)) {
        const kind = lstatSync(destination).isSymbolicLink() ? "link" : "path";
        throw new Error(`Refusing to replace existing ${kind}: ${destination}`);
    }
}
for (const [name, source] of dependencies) {
    const destination = resolve("node_modules", name);
    mkdirSync(resolve("node_modules", name.split("/")[0]), { recursive: true });
    symlinkSync(source, destination, "junction");
    console.log(`Linked ${name} -> ${source}`);
}
