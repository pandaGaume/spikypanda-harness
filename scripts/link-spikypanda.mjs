import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";

const checkout = resolve(process.argv[2] ?? process.env.SPIKYPANDA_REPO ?? "../../spikypanda");
const dependencies = [
    ["core", resolve(checkout, "packages/dev/core")],
    ["nodeeditor", resolve(checkout, "packages/dev/nodeeditor")],
];

for (const [name, source] of dependencies) {
    const manifest = resolve(source, "package.json");
    if (!existsSync(manifest)) throw new Error(`Missing SpikyPanda package: ${manifest}`);
    const parsed = JSON.parse(readFileSync(manifest, "utf8"));
    if (parsed.name !== `@spiky-panda/${name}`) {
        throw new Error(`Unexpected package at ${source}: ${String(parsed.name)}`);
    }
}

const scope = resolve("node_modules/@spiky-panda");
mkdirSync(scope, { recursive: true });
for (const [name, source] of dependencies) {
    const destination = resolve(scope, name);
    if (existsSync(destination)) {
        const kind = lstatSync(destination).isSymbolicLink() ? "link" : "path";
        throw new Error(`Refusing to replace existing ${kind}: ${destination}`);
    }
    symlinkSync(source, destination, "junction");
    console.log(`Linked @spiky-panda/${name} -> ${source}`);
}

