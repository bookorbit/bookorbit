# AI Usage Policy

ProjectX is maintained by real people. Every pull request, issue, and discussion is read and reviewed by humans who give their time to this project. Submitting unreviewed, untested AI output shifts the burden of that review onto maintainers - that is the problem this policy addresses. It is not a problem with AI tools themselves.

## The Rules

- **All AI use must be disclosed.** If any part of your contribution was written, generated, or significantly shaped by an AI tool, say so in the PR description. There are no exceptions and no minimum threshold. See [Disclosure Format](#disclosure-format) below.

- **You must understand every line you submit.** If you cannot explain what a piece of code does, why it is structured the way it is, and how it fits into the surrounding system - do not submit it. "The AI wrote it" is not an answer during review.

- **AI-generated tests must validate real behavior.** Tests that mock away the logic under test, assert on implementation details instead of outcomes, or trivially pass regardless of what the code does will be rejected. Read every assertion before submitting.

- **No AI-generated media.** Images, icons, audio, video, and other non-text assets must be human-created or properly licensed. Text and code are the only acceptable forms of AI-generated content, subject to the rules above.

- **Clean up before submitting.** Remove AI boilerplate, placeholder comments, dead code, and empty catch blocks. Submit only what you would be comfortable having reviewed line by line.

## Disclosure Format

Include this in your PR description whenever AI tools were used:

```
AI tools used: [tool name, e.g. Claude, Copilot, Cursor]
Extent: [what it helped with, e.g. "generated the DTO scaffolding and test boilerplate; all service logic and ownership checks written manually"]
```

Be honest. A brief, accurate note is better than a vague one that obscures how much the AI contributed.

## Consequences

PRs that contain undisclosed AI use or that are clearly unreviewed AI output will be closed immediately with a short explanation. There is no detailed feedback given for this - that burden belongs to the contributor, not the reviewer.

You are always welcome to resubmit once the work is genuinely reviewed, tested, and properly disclosed. The door is not closed permanently.

## Watch Out for These

AI tools make specific, recurring mistakes on this codebase. Be especially careful here.

**Drizzle ORM hallucinations.** LLMs are trained heavily on Prisma and will generate Prisma-style calls - `.findMany()`, `.findUnique()`, `.create()` - that do not exist in Drizzle. Drizzle uses a query builder. Verify every database call against the [Drizzle documentation](https://orm.drizzle.team/docs/overview) and against how the rest of the codebase does it.

**NestJS decorator and module mistakes.** AI frequently invents decorator options, misuses pipes, omits required module imports, or generates module wiring that looks plausible but is wrong. Check every decorator and every module registration.

**Ownership and multi-tenancy logic.** ProjectX is a multi-user app. Every query that touches user-owned data must filter by `userId`. AI-generated service methods routinely omit this. A missed ownership check is a data exposure bug, not a style issue. This applies to every module that manages libraries, books, collections, reading sessions, annotations, and preferences.

**Authorization patterns.** We have specific conventions for permission gates: `@RequirePermission(...)` on the backend, `usePermissions()` on the frontend, and the `LensService` superuser-bypass pattern. AI does not know these patterns and will generate code that bypasses them or reimplements them incorrectly. Write auth and permission logic yourself.

**Tests that prove nothing.** AI-generated tests often mock the exact thing being tested, assert on shallow output without triggering the real path, or simply confirm that a function returns without throwing. Before submitting a test, ask: would this test fail if the implementation were broken? If the answer is no, the test is not worth having.

## How to Use AI Well Here

AI is a genuinely useful tool when applied with judgment. Here is what works well on this project:

- Use AI to scaffold boilerplate: DTOs, module wiring, Vue component structure, test file setup. Review and adjust everything it produces.
- Use AI to explain unfamiliar patterns, library APIs, or architectural concepts. Understanding-driven use is the best use.
- Write authentication, authorization, and ownership-critical logic yourself. These are the areas where a mistake has real consequences for real users.
- When AI generates a service method, read every line with the question: does this correctly scope to the current user? Does it throw the right exception for unauthorized access?
- Run the full stack after every AI-assisted change. `pnpm dev` plus manual verification is not optional.
- Use AI to generate a test structure, then replace every assertion with one you wrote and understand yourself.

## A Note on Maintainers

These rules apply to outside contributors. Maintainers are exempt. They have demonstrated judgment and accountability over time, and are trusted to apply discretion in how they use AI tools in their own work.

## AI is Welcome Here

To be clear: this policy is not an anti-AI stance. Maintainers use AI tools. Many parts of this codebase were written with AI assistance.

The problem this policy addresses is unqualified, unreviewed output being submitted as a contribution - work that the contributor has not run, does not understand, and cannot stand behind. That is a burden on maintainers regardless of whether it came from a human or a machine.

Use the tools. Do the work.

---

_This policy was written with reference to the [Ghostty AI Policy](https://github.com/ghostty-org/ghostty/blob/main/AI_POLICY.md), which we found thoughtful and worth building from._
