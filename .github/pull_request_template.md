> [!IMPORTANT]
> Ready-for-review PRs must satisfy every applicable section below. Incomplete submissions are closed
> without detailed review, and you are welcome to resubmit once complete. Open a draft PR if the work
> is not finished.

Closes #

- **Type:** bug fix | feature | refactor | docs | chore
- **UI changed:** yes | no
- **How I ran this:** `pnpm dev` | Docker | I did not run it
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

UI changes require screenshots. Changes to behavior or interaction also require a short recording of
the complete workflow. Screenshots must show the surrounding browser window rather than a cropped
element, and recordings must start from a page load. For backend changes, paste the log lines your
change emits.

<!-- Drag files in here, or write "No UI changes." -->

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
- [ ] I read every line of the final diff
- [ ] `pnpm verify` passes against the final diff
- [ ] Tests added or updated per the [testing expectations](https://github.com/bookorbit/bookorbit/blob/main/docs/CONTRIBUTING.md#phase-7-write-and-run-tests)
- [ ] User-facing text is localized and accessibility was checked, where applicable
- [ ] Documentation updated, where applicable
- [ ] No unintended files, secrets, build artifacts, or personal configuration included
- [ ] No new dependencies, or the addition was discussed and approved in the linked issue
- [ ] I followed the [contribution guidelines](https://github.com/bookorbit/bookorbit/blob/main/docs/CONTRIBUTING.md) and [commit guidelines](https://github.com/bookorbit/bookorbit/blob/main/docs/COMMIT_GUIDELINES.md)

</details>
