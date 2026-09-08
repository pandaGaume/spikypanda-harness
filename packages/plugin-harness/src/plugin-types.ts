import type { INodeMeta, IRuntimeNode } from "@spiky-panda/core";

export interface HarnessNodeRegistry {
    register(type: string, factory: () => IRuntimeNode, meta: Omit<INodeMeta, "type">): void;
}

export interface HarnessPluginContext {
    readonly id: string;
    readonly nodes: HarnessNodeRegistry;
}

export interface HarnessPlugin {
    activate(ctx: HarnessPluginContext): void | Promise<void>;
    readonly subPlugins?: Record<string, HarnessPlugin>;
}

