> [!IMPORTANT]
> Before writing code or opening a PR, including a draft, discuss your approach in the linked issue
> and wait for a maintainer to approve it and assign the issue to you. PRs opened without prior
> approval and assignment will be closed without review. After approval, open a draft PR if the work
> is not finished.
>
> Fill out every required section of this template. Do not remove or materially alter the template.
> Blank or incomplete submissions will be closed immediately without review.
>
> Complete the PR description and all issue and review replies personally. AI tools and coding
> agents may not draft, rewrite, populate, or submit them. Keep discussion brief, direct, and
> specific. Do not post walls of text, generated summaries, generic explanations, or restatements
> of the issue or diff. Maintainers will not respond to AI-written discussion or replies, and the PR
> will be closed.
>
> Maintainers may ask you to explain the diff or personally demonstrate selected behavior.

Closes #

- **Maintainer approval:** (link to the approval comment)
- **Assigned contributor:** @
- **UI changed:** yes | no
- **Evidence commit:** <!-- Full SHA. Evidence must match this commit. -->

## What changed

<!-- In your own words: the problem, your approach, and anything intentionally left out. -->

## Impact

<!-- List only the applicable areas and briefly explain each one:
API/shared types, database/data, permissions/user isolation,
filesystem/external input, UI/accessibility/localization, performance,
configuration/deployment/dependencies. Write "None" if none apply. -->

## Verification

**Commands run.** Paste the real output tail, including the summary lines. Do not reconstruct or
summarize it.

<!-- Remove any secrets or personal filesystem paths before posting. -->

```text

```

**Personal verification**

Answer in your own words and be specific. "Tests pass" is not manual testing. Keep each answer
concise.

1. **What did you personally test, and what did you observe?**

2. **What is most likely to regress, and how did you check it?**

**Anything you could not test or verify:**

<!-- Write "None" only if nothing applicable remains unverified. -->

## Evidence

Upload a video of yourself using the change in the app. Show what it looked like before, what you
did, and what happened.

Record it yourself. Videos made by a model, or by a coding agent driving the app, do not count, and
the PR will be closed without review.

Evidence must represent the commit listed above. If the implementation changes, rerun the affected
checks and replace any stale evidence before requesting review.

<!-- Video here. -->

## Authorship and review

AI assistance is welcome on this project; unreviewed AI output is not. See the
[AI usage policy](https://github.com/bookorbit/bookorbit/blob/main/docs/AI_POLICY.md).

- **AI tools used:**
- **Extent (what they wrote, and what you wrote):**
- **How you verified their output yourself:**

<!-- Write "None" for each field if no AI tool was involved. -->

<details open>
<summary><b>Contributor checklist</b></summary>

- [ ] This is one focused change approved and assigned before implementation.
- [ ] I personally authored this submission, reviewed the diff, and can explain every change.
- [ ] I disclosed all AI assistance, limitations, and unverified behavior.
- [ ] The required tests and `pnpm verify` pass against the evidence commit.
- [ ] No unintended files, secrets, personal configuration, or unapproved dependencies are included.
- [ ] I followed the [contribution guidelines](https://github.com/bookorbit/bookorbit/blob/main/docs/CONTRIBUTING.md) and [commit guidelines](https://github.com/bookorbit/bookorbit/blob/main/docs/COMMIT_GUIDELINES.md).

</details>
