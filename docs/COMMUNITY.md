# BookOrbit Community

GitHub Issues is the home for BookOrbit questions, help, and community conversations, alongside bug reports and feature requests. Questions are welcome, even if you are unsure whether something is a bug. You do not need approval or assignment to ask a question or start a conversation.

## Choose a Category

| Category                                                                                          | When to use it                                                                         | Browse topics                                                                                              |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [Question / Help](https://github.com/bookorbit/bookorbit/issues/new?template=question.yml)        | Setup, configuration, troubleshooting, and using BookOrbit.                            | [Help requests](https://github.com/bookorbit/bookorbit/issues?q=is%3Aissue%20label%3Asupport)              |
| [Community Discussion](https://github.com/bookorbit/bookorbit/issues/new?template=discussion.yml) | Workflows, ideas, sharing your setup, companion apps, integrations, and show-and-tell. | [Community conversations](https://github.com/bookorbit/bookorbit/issues?q=is%3Aissue%20label%3Adiscussion) |
| [Bug Report](https://github.com/bookorbit/bookorbit/issues/new?template=bug_report.yml)           | Something is broken or behaves differently than documented.                            | [Bug reports](https://github.com/bookorbit/bookorbit/issues?q=is%3Aissue%20label%3Abug)                    |
| [Feature Request](https://github.com/bookorbit/bookorbit/issues/new?template=feature_request.yml) | A concrete new capability or improvement.                                              | [Feature requests](https://github.com/bookorbit/bookorbit/issues?q=is%3Aissue%20label%3Afeature)           |

Search existing topics, including closed issues, before opening a new one. If an existing topic answers your question, you can use it directly. If your situation differs, open a new topic and link the relevant one. The [documentation](https://bookorbit.app) is also a good place to start.

Keep one topic per issue, use a descriptive title, and be respectful of other users and maintainers. Community help depends on people's available time; opening an issue does not guarantee a response.

## Asking for Help

Describe what you want to achieve and where you are stuck. If relevant, include what you have tried, your BookOrbit version, deployment method, and client or device. Logs and screenshots are optional; share only relevant excerpts and remove passwords, tokens, private book content, and other sensitive information.

NAS and network storage configurations are unsupported. Storage-related problems must be reproduced on supported local storage before requesting troubleshooting help. See [unsupported storage configurations](../README.md#unsupported-storage-configurations).

Do not report security vulnerabilities in public issues. Follow the private reporting process in the [security policy](../.github/SECURITY.md).

## How Topics Are Handled

- New topics receive `needs-triage`. Maintainers remove it after reviewing the category and any next steps.
- Help requests use `support`. The `help wanted` label is reserved for contribution opportunities.
- If a help request reveals a bug, maintainers can replace `support` with `bug` and ask for any missing reproduction details. The existing issue and conversation stay together.
- When a question is answered, a maintainer adds `answered`, summarizes the solution or links to the helpful comment, and closes the issue. GitHub Issues does not have an accepted-answer feature. An unanswered issue closed for inactivity does not receive `answered`.
- Community topics use `discussion` and are exempt from automatic stale closure. Maintainers can still close duplicates or topics that have reached a conclusion.
- If a conversation produces actionable work, create a linked bug report or feature request and keep the community conversation available for context. An idea being discussed does not mean it is approved for implementation.
- Other inactive issues, including help requests, receive a stale warning after 60 days and close after another 14 days without activity. If help is still needed, leave an update before closure or request reopening afterward. Maintainers can use `pinned` to exempt a topic from stale closure.

Before implementing a change, follow the approval and assignment process in [CONTRIBUTING.md](CONTRIBUTING.md). Those requirements apply to code contributions, not to asking for help or joining a conversation.
