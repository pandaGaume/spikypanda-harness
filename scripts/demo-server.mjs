import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json" };

export function browserCommand(port, platform = process.platform) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid browser port");
    const url = `http://127.0.0.1:${port}/`;
    if (platform === "win32") return { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", `Start-Process -FilePath '${url}'`] };
    if (platform === "darwin") return { command: "open", args: [url] };
    if (platform === "linux") return { command: "xdg-open", args: [url] };
    throw new Error(`Automatic browser opening is unsupported on ${platform}`);
}

export function openDemoBrowser(port, { platform = process.platform, spawnProcess = spawn } = {}) {
    const { command, args } = browserCommand(port, platform);
    return new Promise((resolveLaunch, reject) => {
        const child = spawnProcess(command, args, { stdio: "ignore", windowsHide: true });
        child.once("error", reject);
        child.once("close", code => code === 0 ? resolveLaunch() : reject(new Error(`Browser launcher exited with code ${code}`)));
    });
}

function listen(server, port) {
    return new Promise((resolveListen, reject) => {
        const cleanup = () => { server.off("error", failed); server.off("listening", ready); };
        const failed = error => { cleanup(); reject(error); };
        const ready = () => { cleanup(); resolveListen(); };
        server.once("error", failed);
        server.once("listening", ready);
        server.listen(port, "127.0.0.1");
    });
}

export async function startDemoServer({ root, port = 4175, openBrowser = true,
    browserOpener = openDemoBrowser, log = console.log, warn = console.warn } = {}) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("HARNESS_PORT must be an integer between 1 and 65535");
    root = resolve(root);
    if (!(await stat(resolve(root, "index.html"))).isFile()) throw new Error("Build the browser demo before starting the server");
    const identity = { app: "spikypanda-harness-demo", version: 1,
        rootId: createHash("sha256").update(process.platform === "win32" ? root.toLowerCase() : root).digest("hex") };
    const url = `http://127.0.0.1:${port}/`;
    const server = createServer(async (req, res) => {
        try {
            if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
            const url = new URL(req.url, "http://localhost");
            if (url.pathname === "/__harness_demo__") {
                res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                res.end(req.method === "HEAD" ? undefined : JSON.stringify(identity));
                return;
            }
            const path = resolve(root, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
            if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
            if (!(await stat(path)).isFile()) throw new Error("Not a file");
            const content = req.method === "HEAD" ? undefined : await readFile(path);
            res.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
            res.end(content);
        } catch { res.writeHead(404); res.end("Not found"); }
    });
    let reused = false;
    try {
        await listen(server, port);
    } catch (error) {
        if (error.code !== "EADDRINUSE") throw error;
        let existing;
        try {
            const response = await fetch(`${url}__harness_demo__`, { signal: AbortSignal.timeout(1500), redirect: "error" });
            if (response.ok) existing = await response.json();
        } catch { /* An unknown service or an older launcher must not be reused. */ }
        if (existing?.app !== identity.app || existing?.version !== identity.version || existing?.rootId !== identity.rootId) {
            throw new Error(`Port ${port} is occupied by another service or an older demo. Stop that instance first (Ctrl+C in its terminal). No alternate port or extra server was started.`);
        }
        reused = true;
    }
    log(reused ? `Harness demo already running, reusing ${url}` : `Harness demo: ${url}`);
    if (openBrowser) {
        try { await browserOpener(port); }
        catch (error) { warn(`Could not open the browser: ${error.message}. Open ${url} manually.`); }
    }
    return { server: reused ? null : server, url, reused };
}
