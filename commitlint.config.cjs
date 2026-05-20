module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", ["feat", "fix", "db", "perf", "refactor", "style", "docs", "test", "build", "ci", "chore", "security", "revert"]],
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [2, "always", 250],
    "subject-full-stop": [2, "never", "."],
    "scope-enum": [0],
    "scope-empty": [0],
  },
};
