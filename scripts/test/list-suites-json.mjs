import { listE2ESuites } from "./e2e-suites.mjs";

process.stdout.write(
  JSON.stringify(listE2ESuites().map(({ id, name, timeout }) => ({ id, name, timeout })))
);
