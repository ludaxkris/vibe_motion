import type { ElementInfo } from "bridge";

import type { Assignment } from "@/lib/api-client";

export type Viewport = { width: number; height: number };

type Shared = {
  /**
   * Assignments already on the page, for context. The caller decides which
   * elements are candidates (see `selectAutoCandidates`, plan Task 4); an agent
   * may be asked about an element that appears here.
   */
  existing: Record<string, Assignment>;
  prompt: string;
  viewport: Viewport;
  catalogVersion: string;
  signal?: AbortSignal;
};

export type ElementContext = Shared & { element: ElementInfo };
export type PageContext = Shared & {
  /** The elements the agent may assign. */
  elements: ElementInfo[];
  /**
   * Listed elements the agent may NOT assign but that already animate as a
   * block (an entrance the designer owns). Nesting is decided against these
   * too: what sits inside one is left alone. Optional, so an older caller
   * stays valid.
   */
  context?: ElementInfo[];
};

export type SkipReason = "not-semantic" | "too-small" | "hidden" | "nested" | "too-large";

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
