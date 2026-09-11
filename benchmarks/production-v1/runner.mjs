import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { suite, freeze, sha256 } from "./scenario.mjs";
import { ACTIONS, ProductionPlant, authorize } from "./plant.mjs";
import { summarizeRun } from "./metrics.mjs";

const hashFile = path => sha256(readFileSync(new URL(path, import.meta.url), "utf8"));
export const sourceIdentity = freeze({ contractVersion: suite.contractVersion, metricsVersion: suite.metricsVersion,
    plantSourceHash: hashFile("./plant.mjs"), generatorSourceHash: hashFile("./scenario.mjs"),
    metricSourceHash: hashFile("./metrics.mjs"), runnerSourceHash: hashFile("./runner.mjs"),
    memoryProtocol: suite.memoryProtocol, providerFingerprint: "local-rules:" + hashFile("./controllers/reference.mjs"),
    track: "closed-loop-control" });
const timeoutMessage = "Decision deadline exceeded";
async function bounded(call, milliseconds) {
    let timer;
    try {
        return await Promise.race([Promise.resolve().then(call),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(timeoutMessage)), milliseconds); })]);
    } finally { clearTimeout(timer); }
}
const errorText = error => String(error?.message ?? error);
/** Contract 2: a graph may call the same one-shot host dispatch used by decide/learn adapters.
 * Only dispatch owns the plant. The callback expires with its step, including after failure.
 * Trusted in-process adapters are not a security sandbox.
 */
export async function runCase(testCase, createController, { clock = () => performance.now(), deadlineMs = suite.timing.deadlineMs } = {}) {
    if (deadlineMs !== suite.timing.deadlineMs) throw new Error("The deadline is part of the versioned protocol");
    const { tapeHash, suiteHash, ...caseData } = testCase;
    if (suiteHash !== sha256(suite) || tapeHash !== sha256(caseData)) throw new Error("Corrupt or foreign scenario tape");
    const plant = new ProductionPlant(testCase), rows = [], timeline = [];
    const setupStart = clock();
    const controller = await bounded(() => createController(freeze({ contractVersion: suite.contractVersion, objective: suite.objective,
        actions: ACTIONS, stepSeconds: suite.stepSeconds, deadlineMs })), deadlineMs);
    const graphAdapter = typeof controller?.step === "function";
    if (!controller || typeof controller.id !== "string" || !controller.id ||
        (!graphAdapter && typeof controller.decide !== "function") ||
        (graphAdapter && (controller.decide || controller.learn))) throw new Error("Invalid or ambiguous controller adapter");
    const setupMs = clock() - setupStart;
    let stoppedByError = null;
    for (let tick = 0; tick < testCase.frames.length; tick++) {
        const observation = plant.observe(), decisionAttempted = !stoppedByError, signal = new AbortController();
        const begin = clock();
        let response, result, authorization, feedback, diagnostics = null, dispatchAt = null;
        let error = stoppedByError, decisionWallMs = 0, learnWallMs = 0, deadlineMissed = false;
        let open = decisionAttempted, used = false, protocolError = null;
        const dispatch = proposal => {
            if (!open || signal.signal.aborted) throw new Error("Dispatch belongs to a closed step");
            if (used) { protocolError = "Only one dispatch is allowed per step"; throw new Error(protocolError); }
            if (clock() - begin > deadlineMs) { protocolError = timeoutMessage; throw new Error(protocolError); }
            used = true;
            response = { actionId: typeof proposal?.actionId === "string" ? proposal.actionId.slice(0, 128) : null,
                rationale: typeof proposal?.rationale === "string" ? proposal.rationale.slice(0, 1000) : null };
            decisionWallMs = clock() - begin;
            authorization = authorize(response.actionId, observation);
            result = plant.advance(authorization.effective);
            feedback = freeze({ before: observation, requestedAction: response.actionId,
                dispatchedAction: authorization.effective, refusal: authorization.reason, after: result.observation });
            dispatchAt = clock();
            return feedback;
        };
        if (decisionAttempted) {
            try {
                const completion = await bounded(async () => {
                    if (graphAdapter) return await controller.step(observation, dispatch, signal.signal);
                    const proposal = await controller.decide(observation, signal.signal);
                    const publicFeedback = dispatch(proposal);
                    if (controller.learn) await controller.learn(publicFeedback, signal.signal);
                    return null;
                }, deadlineMs);
                if (protocolError) throw new Error(protocolError);
                if (!used) throw new Error("Controller completed without dispatch");
                if (completion?.diagnostics !== undefined) {
                    const serialized = JSON.stringify(completion.diagnostics);
                    if (serialized.length > 65536) throw new Error("Oversized controller diagnostics");
                    diagnostics = freeze(JSON.parse(serialized));
                }
            } catch (cause) { error = errorText(cause); stoppedByError = error; }
            finally {
                open = false;
                if (dispatchAt === null) decisionWallMs = clock() - begin;
                else learnWallMs = clock() - dispatchAt;
                deadlineMissed = decisionWallMs + learnWallMs > deadlineMs || error === timeoutMessage;
                if (deadlineMissed) { error ??= timeoutMessage; stoppedByError = error; }
                signal.abort(error ? new Error(error) : new Error("Step completed"));
            }
        } else open = false;
        // Never rewind a completed physical action after a later graph/learning failure.
        if (!result) {
            authorization = { effective: "stop", reason: null };
            result = plant.advance("stop");
        }
        const row = { ...result.truth, requestedAction: response?.actionId ?? null, dispatchedAction: authorization.effective,
            rationale: response?.rationale ?? null, decisionWallMs, learnWallMs, decisionAttempted,
            guardRefused: authorization.reason === "temperature-guard", invalidAction: authorization.reason === "invalid-action",
            controllerError: !!error, deadlineMissed, error, diagnostics, before: observation, after: result.observation };
        rows.push(row);
        if (testCase.markers.some(e => e.tick === tick) || row.guardRefused || row.controllerError || row.interlock ||
            diagnostics?.learningDisposition === "skipped" || diagnostics?.evaluation?.success === false || tick % 30 === 0) {
            timeline.push({ tick, observation, requestedAction: row.requestedAction, dispatchedAction: row.dispatchedAction,
                rationale: row.rationale, trueTemperatureC: row.temperatureC, goodParts: row.goodParts,
                queueParts: row.queueParts, error, diagnostics, events: testCase.markers.filter(e => e.tick === tick) });
        }
    }
    let controllerDiagnostics = null, diagnosticsError = null;
    const diagnosticsStart = clock();
    if (controller.inspect) {
        try { controllerDiagnostics = freeze(JSON.parse(JSON.stringify(await bounded(() => controller.inspect(), deadlineMs)))); }
        catch (error) { diagnosticsError = errorText(error); }
    }
    return { caseId: testCase.id, scenarioId: testCase.scenarioId, seed: testCase.seed, controllerId: controller.id,
        identity: { ...sourceIdentity, suiteHash: testCase.suiteHash, tapeHash: testCase.tapeHash },
        status: stoppedByError ? "controller-error" : "completed", error: stoppedByError, setupMs, metrics: summarizeRun(rows, testCase),
        resources: { llmCalls: 0, inputTokens: null, outputTokens: null, monetaryCost: null, controllerMemoryBytes: null,
            note: "Local deterministic reasoning only; serialized memory is not process RSS or a token estimate." },
        controllerDiagnostics, diagnosticsError, diagnosticsWallMs: clock() - diagnosticsStart, timeline, rows };
}
