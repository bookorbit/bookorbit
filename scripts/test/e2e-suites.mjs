const TEST_RESULTS_DIR = "../test-results/server";

export const E2E_SUITES = Object.freeze({
  smoke: {
    id: "smoke",
    description: "Server smoke suite",
    vitestTarget: "test/app.e2e-spec.ts",
    junitOutput: `${TEST_RESULTS_DIR}/smoke-e2e-junit.xml`,
    prepareDedicatedDatabase: false,
    useDedicatedDatabase: false,
  },
  scanner: {
    id: "scanner",
    description: "Scanner scenario matrix",
    vitestTarget: "test/scanner.e2e-spec.ts",
    junitOutput: `${TEST_RESULTS_DIR}/scanner-e2e-junit.xml`,
    prepareDedicatedDatabase: true,
    useDedicatedDatabase: true,
  },
  "scanner-file-ops": {
    id: "scanner-file-ops",
    description: "Scanner file operation matrix",
    vitestTarget: "test/scanner-file-ops.e2e-spec.ts",
    junitOutput: `${TEST_RESULTS_DIR}/scanner-file-ops-e2e-junit.xml`,
    prepareDedicatedDatabase: true,
    useDedicatedDatabase: true,
  },
  "auth-session-security": {
    id: "auth-session-security",
    description: "Auth session security suite",
    vitestTarget: "test/auth-session-security.e2e-spec.ts",
    junitOutput: `${TEST_RESULTS_DIR}/auth-session-security-e2e-junit.xml`,
    prepareDedicatedDatabase: true,
    useDedicatedDatabase: true,
  },
  "auth-recovery-oidc-logout": {
    id: "auth-recovery-oidc-logout",
    description: "Auth recovery and OIDC logout suite",
    vitestTarget: "test/auth-recovery-oidc-logout.e2e-spec.ts",
    junitOutput: `${TEST_RESULTS_DIR}/auth-recovery-oidc-logout-e2e-junit.xml`,
    prepareDedicatedDatabase: true,
    useDedicatedDatabase: true,
  },
  "staging-ingest-finalize": {
    id: "staging-ingest-finalize",
    description: "Staging ingest and finalize suite",
    vitestTarget: "test/staging-ingest-finalize.e2e-spec.ts",
    junitOutput: `${TEST_RESULTS_DIR}/staging-ingest-finalize-e2e-junit.xml`,
    prepareDedicatedDatabase: true,
    useDedicatedDatabase: true,
  },
});

export function listE2ESuites() {
  return Object.values(E2E_SUITES);
}

export function getE2ESuite(suiteId) {
  return E2E_SUITES[suiteId] ?? null;
}
