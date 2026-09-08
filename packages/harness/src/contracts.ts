import type { IRuntimeGraph } from "@spiky-panda/core";
import type { AdaptivePolicyRuntime } from "./runtime.js";
import type { DecisionContext, PolicyCandidate, PolicyFallbackInput, ResolvedDecision, CapabilityResult, State, OutcomeEvaluation } from "./model.js";

/** Labels for diagnostics only, never commands dispatched by the runtime. */
export type HarnessStage = string;
export interface StageEvent { readonly decisionId: string; readonly stage: HarnessStage; readonly status: "start" | "complete" | "error"; readonly message?: string; }
export interface DecisionFrame { readonly decisionId: string; }
export type NodeObserver = (id: string, stage: HarnessStage) => void;
export type HarnessDriver = (runtime: AdaptivePolicyRuntime, frame: DecisionFrame) => Promise<void>;
export interface HarnessRun { readonly frame: DecisionFrame; readonly signal: AbortSignal; readonly startedAt: number; }
export interface LookupResult { readonly context: DecisionContext; readonly candidates: ReadonlyArray<PolicyCandidate>; }
export interface ReasoningRequest { readonly context: DecisionContext; readonly request: Omit<PolicyFallbackInput, "signal">; }
export interface SelectedDecision { readonly context: DecisionContext; readonly decision: ResolvedDecision; readonly candidate?: PolicyCandidate; }
/** Only the session-owned authority can redeem this single-use receipt. */
export interface AuthorizedDecision { readonly authorizationId: string; }
export interface ExecutedDecision extends SelectedDecision { readonly result: CapabilityResult; }
export interface ObservedOutcome extends ExecutedDecision { readonly stateAfter: State; }
export interface EvaluatedExperience extends ObservedOutcome { readonly evaluation: OutcomeEvaluation; }
export interface NodeEmission { readonly slot: string; readonly value: unknown; }
export interface HarnessGraphExecutor {
    executeGraph(graph: IRuntimeGraph, frame: DecisionFrame, onNode?: NodeObserver): Promise<void>;
}

