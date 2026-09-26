# Pull request inactivity policy

The scheduled workflow checks every open pull request daily. It does not use GitHub's pull request `updated_at` timestamp. It counts human comments, submitted reviews, review comments, reopening, and marking ready for review. It also records when it first sees each head commit, so a new push resets the clock even if that commit has an old author date. Bot comments and CI updates do not reset it.

The first run writes one automation state comment per open PR and starts its inactivity clock at that run. This conservative baseline avoids closing existing PRs from unverifiable historical push dates. Future head changes update that comment. After 30 full days without qualifying activity, the workflow adds `stale` and posts a warning. It closes the PR only after 14 more full days without qualifying activity, following a fresh API check. A `pinned` label exempts the PR.

Use the workflow's manual **dry-run** mode to audit decisions without writes. The log records one decision per PR and ends with the number inspected. An API or pagination error fails the run. The policy and API behavior are covered by `pnpm test:pr-policy`.
