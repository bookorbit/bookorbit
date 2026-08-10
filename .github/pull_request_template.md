> [!IMPORTANT]
> Before writing code or opening a PR, including a draft, discuss your approach in the linked issue
> and wait for a maintainer to approve it and assign the issue to you. PRs opened without prior
> approval and assignment will be closed without review. After approval, open a draft PR if the work
> is not finished.

Closes #

- **Maintainer approval:** (link to the approval comment)
- **Assigned contributor:** @
- **UI changed:** yes | no
- **Evidence captured at commit:** (run `git rev-parse --short HEAD`)

## What changed

<!-- What changed, why it is needed, and what a user sees differently. Two or three sentences. -->

## Verification

**Commands run.** Paste the real output tail, including the summary lines. Do not reconstruct or
summarize it.

```text

```

**Manual testing.** Answer in your own words and be specific. "Tests pass" is not manual testing.

1. **First thing you did once it was running, and what you saw:**

2. **What went wrong or surprised you along the way:**

3. **What this change is most likely to break, and how you checked that specifically:**

**Anything you could not test:**

## Evidence

Upload a video of yourself using the change in the app. Show what it looked like before, what you
did, and what happened.

Record it yourself. Videos made by a model, or by a coding agent driving the app, do not count, and
the PR will be closed without review.

<!-- Video here. -->

## Authorship and review

AI assistance is welcome on this project; unreviewed AI output is not. See the
[AI usage policy](https://github.com/bookorbit/bookorbit/blob/main/docs/AI_POLICY.md).

- **AI tools used:**
- **Extent (what they wrote, and what you wrote):**
- **How you verified their output yourself:**
- [ ] I can explain any line of this diff on request

<!-- Write "None" for each field if no AI tool was involved. -->

<details open>
<summary><b>Contributor checklist</b></summary>

- [ ] One focused change, linked above to an issue a maintainer approved
- [ ] I discussed my approach and was assigned the issue before writing code or opening this PR
- [ ] `pnpm verify` passes against the final diff
- [ ] Tests added or updated per the [testing expectations](https://github.com/bookorbit/bookorbit/blob/main/docs/CONTRIBUTING.md#phase-7-write-and-run-tests)
- [ ] User-facing text uses Vue I18n keys added only to `client/src/locales/en.json`; non-English catalogs are unchanged, and accessibility was checked
- [ ] Documentation updated, where applicable
- [ ] No unintended files, secrets, build artifacts, or personal configuration included
- [ ] No new dependencies, or the addition was discussed and approved in the linked issue
- [ ] I followed the [contribution guidelines](https://github.com/bookorbit/bookorbit/blob/main/docs/CONTRIBUTING.md) and [commit guidelines](https://github.com/bookorbit/bookorbit/blob/main/docs/COMMIT_GUIDELINES.md)

</details>
