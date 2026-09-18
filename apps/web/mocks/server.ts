/**
 * msw/node server, wired into `vitest.setup.ts`.
 *
 * `onUnhandledRequest: "error"` makes any request without a matching handler
 * fail the test loudly rather than hitting the real network.
 */
import { setupServer } from "msw/node";

import { handlers } from "./handlers";

export const server = setupServer(...handlers);
