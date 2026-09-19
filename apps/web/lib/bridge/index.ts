/**
 * The shell's preview-bridge client.
 *
 * `client.ts` is framework-free (a `Window`, an origin and a store handle);
 * Phase 4 Task 9 adds the React hook that mounts it on the editor's iframe.
 * The wire types and constants live in the `bridge` workspace package, which
 * the API and the Phase 7 exporter share.
 */
export { createBridgeClient } from "./client";
export type { Ack, BridgeClient, BridgeClientOptions, BridgeStatus } from "./client";
export { isUnresolved, toApplied } from "./to-applied";
export type { Unresolved, UnresolvedReason } from "./to-applied";
