import type { ElementInfo } from "bridge";

import type { Assignment } from "@/lib/api-client";

export type Viewport = { width: number; height: number };

type Shared = {
  /** Assignments the agent must not replace; context only. */
  existing: Record<string, Assignment>;
  prompt: string;
  viewport: Viewport;
  catalogVersion: string;
  signal?: AbortSignal;
};

export type ElementContext = Shared & { element: ElementInfo };
export type PageContext = Shared & { elements: ElementInfo[] };

export type SkipReason = "not-semantic" | "too-small" | "hidden";

export type PageSuggestion = {
  /** Keyed by vmId. */
  assignments: Record<string, Assignment>;
  skipped: { vmId: string; reason: SkipReason }[];
};

/** Async so a server-side agent (DT-003) changes no call site. */
export interface AnimationAgent {
  suggestForElement(ctx: ElementContext): Promise<Assignment>;
  suggestForPage(ctx: PageContext): Promise<PageSuggestion>;
}
