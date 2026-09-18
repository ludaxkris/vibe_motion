import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without globals, so React Testing Library's auto-cleanup does not
// register itself. Do it here.
afterEach(() => {
  cleanup();
});
