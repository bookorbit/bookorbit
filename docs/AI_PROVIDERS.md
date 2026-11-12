# AI Providers

AI features, such as the story guides behind Constellations, send book text to a language model. BookOrbit does not bundle a model: an administrator connects one under **Settings > Server > AI**, chooses which model each kind of request uses, and sets a budget. Nothing is sent anywhere until a connection is added and a feature is turned on.

Managing AI needs the **App settings** permission (`manage_app_settings`).

## The encryption key

Provider keys and header values are stored encrypted with `AI_ENCRYPTION_KEY`, a 64-character hex string:

```bash
openssl rand -hex 32
```

Put it in `.env` beside the other secrets. With the Docker image you can instead mount it as a file and set `AI_ENCRYPTION_KEY_FILE` to its path, the same way as `JWT_SECRET_FILE`. Restart the server after setting it.

- **Without the key**, the AI page shows a banner with the command above, and a connection with a key or a header value is refused rather than stored in the clear. A connection without a key, such as a local Ollama or LM Studio, saves without it.
- **Changing or removing the key** leaves saved keys unreadable. Each affected connection shows "The saved key can't be read. Enter it again." until its key is typed again, and builds that need it pause instead of failing halfway.
- Keep the key with your backups. A database restored without it has connections whose keys must be entered again.

## Adding a connection

**Add provider** offers presets for OpenAI, Anthropic, Google Gemini, OpenRouter, CLIProxyAPI, Ollama, LM Studio, vLLM and Azure OpenAI, and **Other** for any server that speaks the OpenAI API. Pasting a URL instead picks the preset and API type from the address. A preset only fills in the form; every field can still be changed.

- **Base URL**: pasted endpoints such as `.../v1/chat/completions` are trimmed to the base, and the form shows the exact URL requests will go to.
- **API type**: OpenAI-compatible (Chat Completions), Anthropic Messages, or OpenAI Responses. Most providers and proxies speak OpenAI-compatible. Use Anthropic Messages for Anthropic itself, and for Claude behind a proxy that offers it, since that is where a JSON schema is enforced.
- **API key**: optional for local runners. After saving, only the last four characters are shown.
- **Advanced**: extra headers (values hidden after saving), an HTTP proxy, DNS servers, the timeout, parallel requests and a requests-per-minute limit.

Saving runs a test first, with a very small request for each check: the server is reachable, the key is accepted, models are listed, the model answers in JSON, and token usage is reported. A connection can be saved with a failing test, since a provider can be briefly down. A connection that fails with something that may pass by itself, such as a timeout or a rate limit, is tested again every 15 minutes for a day.

Addresses on your own network are allowed, because local runners live there. Link-local addresses and cloud metadata services are never allowed, and redirects are not followed.

### Subscriptions are not keys

ChatGPT, Claude and Gemini consumer plans sign in with an account, not an API key, and BookOrbit does not do those sign-ins. Any service that offers one of the three API types works, including a proxy you run yourself; whether a given proxy is allowed is between you and your provider.

## Models

Features send requests to two slots:

- **Fast**: many small requests, such as reading each passage. A quick, low-cost model fits.
- **Careful**: fewer requests that need the best judgement, such as the final review.

Each slot names a connection and a model; both may use the same one. Prices, in dollars per million input and output tokens, are filled in when the provider's model list carries them (OpenRouter does) and can be typed otherwise. **Try it** runs a short story-guide passage on a public-domain excerpt and shows what the model found, how long it took and what it cost, which is a cheap way to judge a model before a real book.

Story guides were measured with GPT-6 Luna in the Fast slot and GPT-6.1 Terra in the Careful slot. Other models work, but may be less accurate, and small local models are often unreliable at JSON.

## Features

Each feature has a switch, its own limits and an optional share of the budget. Turning a feature on for the first time asks for a confirmation: the whole text of each book built is sent to the provider you chose; readers' accounts, reading positions and notes are not. The page records who confirmed and when.

Turning a feature off stops new builds and pauses running ones. What it already built stays available, because serving it sends nothing to the provider.

## Budget

- A monthly budget in dollars for the whole server, and optionally per feature. Months run in the server's time zone (`TZ`).
- At 80% the page warns. At 100% new requests stop and builds pause until the budget is raised or the month turns.
- A build reserves its estimate when it starts, so one that does not fit in what is left waits instead of stopping halfway. A build that has spent three times its estimate pauses until someone continues or cancels it.
- When a slot has no prices, dollars cannot be counted, so a builds-per-month limit applies instead.

## Usage

**View usage** shows this month and the previous eleven: requests, tokens, estimated cost and errors per month, feature and model, the costliest builds and the most recent errors. **Export CSV** downloads the same months. Request-level detail is kept for 90 days, then folded into monthly totals.
