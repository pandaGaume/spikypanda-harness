import { GraphBuilder, GraphNode, GraphOLink, type INode, type IOlink, type IGraph } from "@spiky-panda/core";
import { ContextualPolicyGraph } from "./contextual-policy.js";
import { contextKey, stableStringify } from "./canonical.js";
import { immutableCopy, validateState, validateIntention } from "./validation.js";
import type { DecisionContext, Experience, JsonValue } from "./model.js";
import { DEFAULT_CUE_CONFIG, type CueSchema, type CueConfig, type CueAssessment, type CueCandidate,
    type CueMemorySnapshot, type CueObserver } from "./cue-types.js";

const json = (value: unknown) => stableStringify(value as JsonValue);
const encoder = "harness.adaptive-metric.v1" as const;
interface Sample { experience: Experience; values: (number | null)[]; }
interface Group { id: string; samples: Sample[]; means: (number | null)[]; variances: number[]; }
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const record = (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value);

export function validateCueConfiguration(schema: CueSchema, config: CueConfig): void {
    if (!schema || typeof schema.id !== "string" || !schema.id || !Number.isSafeInteger(schema.version) || schema.version < 1 ||
        Object.keys(schema).some(k => !["id", "version", "fields"].includes(k)) ||
        !Array.isArray(schema.fields) || schema.fields.length < 1 || schema.fields.length > 32) throw new Error("Invalid cue schema");
    const ids = new Set<string>(), paths = new Set<string>();
    for (const field of schema.fields) {
        if (!field || Object.keys(field).some(k => !["id", "path", "scale"].includes(k)) || typeof field.id !== "string" || !field.id || ids.has(field.id) || !finite(field.scale) || field.scale <= 0 ||
            !Array.isArray(field.path) || field.path.length < 1 || field.path.length > 8 ||
            field.path.some((p: string) => typeof p !== "string" || !p || ["__proto__", "prototype", "constructor"].includes(p))) throw new Error("Invalid cue field");
        if (paths.has(json(field.path))) throw new Error("Duplicate cue source");
        ids.add(field.id); paths.add(json(field.path));
    }
    if (!config || !Number.isSafeInteger(config.samplesPerMode) || config.samplesPerMode < 3 || config.samplesPerMode > 256 ||
        !Number.isSafeInteger(config.minimumSamples) || config.minimumSamples < 3 || config.minimumSamples > config.samplesPerMode ||
        !finite(config.recencyDecay) || config.recencyDecay <= 0 || config.recencyDecay >= 1 ||
        !finite(config.minimumRelevance) || config.minimumRelevance <= 0 || config.minimumRelevance >= 1 ||
        !finite(config.maximumDistance) || config.maximumDistance <= 0 || config.maximumDistance > 10 ||
        !finite(config.minimumMargin) || config.minimumMargin <= 0 || config.minimumMargin > 10 ||
        !finite(config.minimumCoverage) || config.minimumCoverage <= 0 || config.minimumCoverage > 1 ||
        Object.keys(config).some(k => !Object.hasOwn(DEFAULT_CUE_CONFIG, k))) throw new Error("Invalid cue configuration");
}

/** First-party adaptive metric, not a pretrained neural model.
 * Feature relevance is learned from bounded, recency-weighted observed mode evidence.
 * Predictions never serve as labels. Every query re-encodes its examples in the same metric.
 */
export class AdaptiveCueObserver implements CueObserver {
    public readonly schema: CueSchema;
    public readonly config: CueConfig;
    constructor(public readonly policy: ContextualPolicyGraph, schema: CueSchema, config: CueConfig = DEFAULT_CUE_CONFIG) {
        validateCueConfiguration(schema, config);
        this.schema = immutableCopy(schema); this.config = immutableCopy(config);
    }
    private values(state: DecisionContext["state"]): (number | null)[] {
        return this.schema.fields.map(field => {
            let value: unknown = state.features;
            for (const part of field.path) value = record(value) && Object.hasOwn(value as object, part)
                ? (value as Record<string, unknown>)[part] : undefined;
            if (value === undefined || value === null) return null;
            if (!finite(value) || !finite(value / field.scale) || Math.abs(value / field.scale) > 1e6) throw new Error("Invalid numeric cue: " + field.id);
            return value / field.scale;
        });
    }
    private model(context: DecisionContext) {
        const scope = contextKey(context.state, context.intention);
        const experiences = this.policy.snapshot().experiences;
        const revision = experiences.reduce((max, e) => Math.max(max, e.attribution?.current.sequence ?? 0), 0);
        const groups: Group[] = this.policy.modes(scope).map(mode => {
            const samples = experiences.filter(e => e.context.key === scope && e.attribution?.current.modeId === mode.id &&
                ["confirmed", "revised"].includes(e.attribution.current.status) && json(e.attribution.signature) === json(mode.signature))
                .map(experience => ({ experience, values: this.values(experience.context.state) }))
                .filter(s => s.values.some(v => v !== null)).slice(-this.config.samplesPerMode);
            const means: (number | null)[] = [], variances: number[] = [];
            this.schema.fields.forEach((_field, i) => {
                const available = samples.map((s, order) => ({ value: s.values[i], weight: this.config.recencyDecay ** (samples.length - 1 - order) }))
                    .filter(s => s.value !== null);
                if (available.length < this.config.minimumSamples) { means.push(null); variances.push(0); return; }
                const sum = available.reduce((n, s) => n + s.weight, 0);
                const mean = available.reduce((n, s) => n + s.value! * s.weight, 0) / sum;
                means.push(mean); variances.push(available.reduce((n, s) => n + s.weight * (s.value! - mean) ** 2, 0) / sum);
            });
            return { id: mode.id, samples, means, variances };
        }).filter(g => g.samples.length >= this.config.minimumSamples);
        const relevance = this.schema.fields.map((_field, i) => {
            if (groups.length < 2 || groups.some(g => g.means[i] === null)) return 0;
            const means = groups.map(g => g.means[i]!);
            const spread = (Math.max(...means) - Math.min(...means)) ** 2;
            const noise = groups.reduce((n, g) => n + g.variances[i], 0) / groups.length;
            const weight = spread / (spread + 4 * noise + 0.01);
            return weight >= this.config.minimumRelevance ? weight : 0;
        });
        return { scope, revision, groups, relevance };
    }
    public assess(context: DecisionContext): CueAssessment {
        validateState(context.state); validateIntention(context.intention);
        const values = this.values(context.state), model = this.model(context);
        const total = model.relevance.reduce((a, b) => a + b, 0);
        const available = model.relevance.reduce((sum, w, i) => sum + (values[i] === null ? 0 : w), 0);
        const coverage = total ? available / total : 0;
        const distance = (other: ReadonlyArray<number | null>) => {
            let sum = 0, weight = 0;
            model.relevance.forEach((w, i) => {
                if (w && values[i] !== null && other[i] !== null) { sum += w * (values[i]! - other[i]!) ** 2; weight += w; }
            });
            return weight ? Math.sqrt(sum / weight) : null;
        };
        const candidates: CueCandidate[] = model.groups.flatMap(group => {
            const d = distance(group.means);
            if (d === null) return [];
            const nearest = group.samples.map(sample => ({ id: sample.experience.id, distance: distance(sample.values) }))
                .filter(s => s.distance !== null).sort((a, b) => a.distance! - b.distance! || a.id.localeCompare(b.id)).slice(0, 3);
            return [{ modeId: group.id, distance: d, experienceIds: nearest.map(n => n.id) }];
        }).sort((a, b) => a.distance - b.distance || a.modeId.localeCompare(b.modeId));
        const status = values.every(v => v === null) ? "missing" : model.groups.length < 2 ? "learning" :
            total === 0 ? "ambiguous" : coverage < this.config.minimumCoverage ? "missing" :
            !candidates.length || candidates[0].distance > this.config.maximumDistance ? "novel" :
            candidates.length < 2 || candidates[1].distance - candidates[0].distance < this.config.minimumMargin ? "ambiguous" : "recognized";
        return immutableCopy({ encoder, schemaKey: json([this.schema, this.config]), modelRevision: model.revision,
            observationKey: json(context.state), scope: model.scope, status, modeId: status === "recognized" ? candidates[0].modeId : undefined,
            features: this.schema.fields.map((field, i) => ({ id: field.id, value: values[i], relevance: model.relevance[i],
                sourceRef: "state.features/" + field.path.map(p => encodeURIComponent(p)).join("/") })),
            embedding: values.map((v, i) => v === null ? null : v * Math.sqrt(model.relevance[i])),
            coverage, candidates });
    }
    public validateAssessment(context: DecisionContext, assessment: CueAssessment): void {
        // Reject substitutions and model/observation mismatch before selecting any action.
        if (json(assessment) !== json(this.assess(context))) throw new Error("Stale or foreign cue assessment");
    }
    public snapshot(): CueMemorySnapshot {
        return immutableCopy({ version: 3, policy: this.policy.snapshot(), observer: { encoder, schema: this.schema, config: this.config } });
    }
    public static restore(snapshot: CueMemorySnapshot): AdaptiveCueObserver {
        snapshot = immutableCopy(snapshot);
        if (!snapshot || snapshot.version !== 3 || snapshot.observer?.encoder !== encoder ||
            Object.keys(snapshot).some(k => !["version", "policy", "observer"].includes(k)) ||
            Object.keys(snapshot.observer).some(k => !["encoder", "schema", "config"].includes(k))) throw new Error("Invalid V3 cue memory");
        const observer = new AdaptiveCueObserver(ContextualPolicyGraph.restore(snapshot.policy), snapshot.observer.schema, snapshot.observer.config);
        const ledger = observer.policy.snapshot().experiences, seen = new Set<string>();
        for (const e of ledger) {
            if (e.cues) {
                const a = e.cues.assessment;
                if (!a || a.encoder !== encoder || a.schemaKey !== json([observer.schema, observer.config]) ||
                    a.observationKey !== json(e.context.state) || a.scope !== e.context.key ||
                    !["shadow", "active"].includes(e.cues.mode) || !["cues", "effect-history", "uncertain", "shadow"].includes(e.cues.basis) ||
                    !["learning", "missing", "ambiguous", "novel", "recognized"].includes(a.status) ||
                    !Number.isSafeInteger(a.modelRevision) || a.modelRevision < 0 ||
                    a.modelRevision >= (e.attribution?.revisions[0].sequence ?? 0) ||
                    !finite(a.coverage) || a.coverage < 0 || a.coverage > 1 ||
                    a.features?.length !== observer.schema.fields.length || a.embedding?.length !== observer.schema.fields.length ||
                    !Array.isArray(a.candidates) || (a.status === "recognized") !== !!a.modeId ||
                    (a.modeId && observer.policy.mode(a.modeId)?.scope !== a.scope)) throw new Error("Invalid stored cue assessment");
                const expectedBasis = e.cues.mode === "shadow" ? "shadow" : a.status === "recognized" ? "cues" :
                    a.status === "learning" ? "effect-history" : "uncertain";
                if (e.cues.basis !== expectedBasis) throw new Error("Invalid stored cue decision basis");
                const values = observer.values(e.context.state);
                a.features.forEach((f, i) => {
                    const field = observer.schema.fields[i];
                    if (f.id !== field.id || f.value !== values[i] || !finite(f.relevance) || f.relevance < 0 || f.relevance > 1 ||
                        f.sourceRef !== "state.features/" + field.path.map(p => encodeURIComponent(p)).join("/") ||
                        a.embedding[i] !== (f.value === null ? null : f.value * Math.sqrt(f.relevance))) throw new Error("Corrupt cue feature or embedding");
                });
                const candidates = new Set<string>();
                for (const c of a.candidates) {
                    if (candidates.has(c.modeId) || observer.policy.mode(c.modeId)?.scope !== a.scope ||
                        !finite(c.distance) || c.distance < 0 || !Array.isArray(c.experienceIds) ||
                        c.experienceIds.length > 3 || new Set(c.experienceIds).size !== c.experienceIds.length ||
                        c.experienceIds.some((id: string) => !seen.has(id) || observer.policy.evidence(id).context.key !== a.scope)) throw new Error("Invalid cue provenance");
                    candidates.add(c.modeId);
                }
                if (a.modeId && a.candidates[0]?.modeId !== a.modeId) throw new Error("Invalid cue selection");
            }
            seen.add(e.id);
        }
        return observer;
    }
    /** Read-only materialization: observed cue nodes and similarity links, not new evidence. */
    public graphView(context: DecisionContext): IGraph<INode, IOlink> {
        const assessment = this.assess(context), base = this.policy.graphView();
        const nodes = new Map(base.nodes.map(n => [String(n.id), n])), links: IOlink[] = [...base.links];
        const observation = new GraphNode(); observation.id = "cue-observation:" + json([assessment.scope, assessment.observationKey]);
        observation.type = "Harness.Memory:cue-observation"; nodes.set(String(observation.id), observation);
        const connect = (from: INode, to: INode, kind: string) => {
            const link = new GraphOLink(from, to); link.id = json([from.id, kind, to.id]); link.type = "Harness.Memory:" + kind; links.push(link);
        };
        for (const feature of assessment.features) {
            const node = new CueFeatureNode(String(observation.id) + ":" + feature.id, feature);
            nodes.set(String(node.id), node); connect(observation, node, "measured");
            if (feature.value !== null && feature.relevance > 0) for (const c of assessment.candidates) for (const id of c.experienceIds) {
                connect(node, nodes.get("experience:" + id)!, "resembles");
            }
        }
        return new GraphBuilder<INode, IOlink>().withNodes(...nodes.values()).withLinks(...links).build();
    }
}
export class CueFeatureNode extends GraphNode {
    constructor(id: string, public readonly feature: CueAssessment["features"][number]) {
        super(); this.id = id; this.type = "Harness.Memory:cue";
    }
}
