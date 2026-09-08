import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { browserCommand, openDemoBrowser, startDemoServer } from "../scripts/demo-server.mjs";

const root = resolve(import.meta.dirname, "../examples/editor");
const quiet = { log() {}, warn() {} };
const close = server => new Promise((resolveClose, reject) => { server.close(error => error ? reject(error) : resolveClose()); server.closeAllConnections(); });
async function freePort() {
    const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
    const port = probe.address().port; await close(probe); return port;
}

test("browser launch commands use the selected local port without a visible helper window", async () => {
    for (const [platform, command] of [["win32", "powershell.exe"], ["darwin", "open"], ["linux", "xdg-open"]]) {
        const call = browserCommand(4182, platform);
        assert.equal(call.command, command);
        assert.ok(call.args.join(" ").includes("http://127.0.0.1:4182/"));
    }
    assert.throws(() => browserCommand("4175; bad command", "win32"), /Invalid/);
    await openDemoBrowser(4182, { platform: "win32", spawnProcess(command, args, options) {
        assert.equal(command, "powershell.exe"); assert.equal(options.windowsHide, true); assert.equal(options.shell, undefined);
        const child = new EventEmitter(); queueMicrotask(() => child.emit("close", 0)); return child;
    } });
    await assert.rejects(openDemoBrowser(4182, { spawnProcess() {
        const child = new EventEmitter(); queueMicrotask(() => child.emit("error", new Error("missing browser"))); return child;
    } }), /missing browser/);
});

test("an occupied port is preserved without choosing another port or opening an unknown service", async t => {
    const blocker = createServer((_req, res) => res.end("other service"));
    blocker.listen(0, "127.0.0.1"); await once(blocker, "listening");
    t.after(() => close(blocker));
    const occupiedPort = blocker.address().port;
    await assert.rejects(startDemoServer({ root, port: occupiedPort, ...quiet,
        browserOpener() { assert.fail("Must not open an unknown service"); } }), /No alternate port or extra server/);
    assert.equal(await (await fetch(`http://127.0.0.1:${occupiedPort}/`)).text(), "other service");
});

test("repeated launches reuse the same checkout on the same port and open only after readiness", async t => {
    const port = await freePort();
    const first = await startDemoServer({ root, port, openBrowser: false, ...quiet });
    t.after(() => close(first.server));
    assert.equal(first.reused, false);
    let opened = 0;
    const second = await startDemoServer({ root, port, ...quiet, browserOpener: async selectedPort => {
        opened++;
        assert.equal(selectedPort, port);
        const response = await fetch(first.url);
        assert.match(await response.text(), /SpikyPanda Harness Lab/);
    } });
    assert.equal(opened, 1);
    assert.equal(second.reused, true);
    assert.equal(second.server, null);
    assert.equal(second.url, first.url);
    await assert.rejects(startDemoServer({ root: resolve(root, "../../.."), port, ...quiet }), /ENOENT|Build/);
});

test("headless mode never launches a browser", async t => {
    const result = await startDemoServer({ root, port: await freePort(), openBrowser: false, ...quiet,
        browserOpener() { assert.fail("Must not launch a browser"); } });
    t.after(() => close(result.server));
    assert.equal((await fetch(result.url)).status, 200);
});

test("a failed browser launcher leaves the server usable and reports its address", async t => {
    const warnings = [];
    const result = await startDemoServer({ root, port: await freePort(), ...quiet, warn: message => warnings.push(message),
        browserOpener: async () => { throw new Error("desktop unavailable"); } });
    t.after(() => close(result.server));
    assert.equal((await fetch(result.url)).status, 200);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes(result.url));
});

test("invalid fixed-port configuration fails cleanly", async () => {
    await assert.rejects(startDemoServer({ root, port: NaN, ...quiet }), /HARNESS_PORT/);
    await assert.rejects(startDemoServer({ root, port: 0, ...quiet }), /HARNESS_PORT/);
    await assert.rejects(startDemoServer({ root, port: 65536, ...quiet }), /HARNESS_PORT/);
});
