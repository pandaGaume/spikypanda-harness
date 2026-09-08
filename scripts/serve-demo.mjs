import { resolve } from "node:path";
import { startDemoServer } from "./demo-server.mjs";

try {
    await startDemoServer({
        root: resolve(import.meta.dirname, "../dist/demo"),
        port: Number(process.env.HARNESS_PORT ?? 4175),
        openBrowser: !process.argv.includes("--no-open") && process.env.HARNESS_OPEN_BROWSER !== "0",
    });
} catch (error) {
    console.error(`Cannot start the Harness demo: ${error.message}`);
    process.exitCode = 1;
}
