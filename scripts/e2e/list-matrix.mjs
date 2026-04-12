import { listE2ESuites } from "./suite-registry.mjs";

process.stdout.write(JSON.stringify(listE2ESuites().map(({ id, name, timeout }) => ({ id, name, timeout }))));
