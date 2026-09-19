/**
 * Fixture HTML served by the mock `GET /projects/{id}/page` and the same-origin
 * `/mock-api/projects/[projectId]/page` route (see `lib/preview-url.ts`).
 *
 * Exported as a string constant — rather than imported from `page.html` at
 * runtime — so the mock handlers work unchanged in both the Node (`msw/node`,
 * used by vitest) and browser (`msw/browser`, used by the dev server / e2e)
 * runtimes without relying on a bundler-specific raw-text import. `page.html`
 * is the human-readable copy of the same markup; `mocks/fixtures/page.test.ts`
 * asserts the two never drift apart.
 *
 * Every element carries `data-vm-id`, matching the contract's assumption that
 * the cloned page (and this fixture standing in for it) tags every element.
 */
export const pageFixtureHtml = `<!doctype html>
<html lang="en" data-vm-id="vm-html">
  <head data-vm-id="vm-head">
    <meta charset="utf-8" />
    <title data-vm-id="vm-title">Fixture Page</title>
  </head>
  <body data-vm-id="vm-body">
    <main data-vm-id="vm-main">
      <h1 data-vm-id="vm-heading">Welcome to the fixture page</h1>
      <p data-vm-id="vm-paragraph">
        This paragraph stands in for a cloned page's body copy while the real
        clone pipeline (Phase 2 API) is mocked out.
      </p>
      <img
        data-vm-id="vm-image"
        alt="Placeholder graphic"
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect width='120' height='80' fill='%23cbd5e1'/%3E%3C/svg%3E"
      />
      <button data-vm-id="vm-button" type="button">Click me</button>
      <div data-vm-id="vm-card">
        <h2 data-vm-id="vm-card-heading">Card title</h2>
        <p data-vm-id="vm-card-body">Card body text for the fixture card.</p>
      </div>
    </main>
  </body>
</html>
`;
