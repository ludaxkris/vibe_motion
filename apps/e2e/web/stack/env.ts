/** Origins inside the Docker e2e stack. Set by apps/e2e/docker/compose.yml on the runner. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; stack specs only run via scripts/e2e-docker.sh`);
  return value;
}

export const stack = {
  webOrigin: required("E2E_WEB_ORIGIN"),
  apiOrigin: required("E2E_API_ORIGIN"),
  fixtureOrigin: required("E2E_FIXTURE_ORIGIN"),
};
