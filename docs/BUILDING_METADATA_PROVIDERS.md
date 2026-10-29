# Building a Metadata Provider

A metadata provider is a small web service that answers BookOrbit's metadata searches from a source
it does not know: a regional catalogue, a fan wiki, a manga database, your own spreadsheet. BookOrbit
calls it over HTTP and never runs its code, so you write it in any language, release it on your own
schedule, and nobody has to change BookOrbit for it.

This guide takes you from an empty folder to a published image that anyone can add to BookOrbit.
To add a provider someone else made, see [External Metadata Providers](METADATA_PROVIDERS.md).

## How it works

```text
BookOrbit                          your provider                    the source
   | GET /search?query=Dune ------->  |                               |
   |                                  | -- its own API or pages ----> |
   |                                  | <---------------------------- |
   | <---- { "matches": [ ... ] } --- |                               |
```

Your provider answers three requests:

- `GET /provider/info`: who it is (name, a permanent key, version, icon, what it can do).
- `GET /search`: books matching a title, author or ISBN, best first.
- `GET /book/{id}`: one book by the id your provider gave it earlier. Optional, but recommended.

BookOrbit caches answers, merges them with its other sources through field rules, stores your ids
on the books it matches, and shows your icon and colour wherever your results appear.

## Before you start

- **Check the source's terms.** You are responsible for how your provider uses its source. Prefer an
  official API over scraping pages: APIs change less often, and many sites forbid scraping.
- **Choose the key now, and never change it.** The key (such as `mangabaka`) is how BookOrbit files
  every id and rating your provider gives it. A provider that changes its key is a new provider to
  BookOrbit, and users have to add it again.
- **Choose a language you will keep maintaining.** There are starters in Rust and Go. Rust is what
  the published providers use: the same provider ran in about a third of Go's memory. Go needs
  nothing but `go run`. Python, Node or anything else that serves JSON works too.

## Quick start

The [bookorbit-metadata-providers](https://github.com/bookorbit/bookorbit-metadata-providers)
repository has a working starter in Rust and one in Go, and a conformance checker. Both starters
serve one made-up book and behave the same; pick the language you prefer.

1. **Copy a starter.**

   ```bash
   git clone https://github.com/bookorbit/bookorbit-metadata-providers.git
   ```

   For Rust:

   ```bash
   cp -R bookorbit-metadata-providers/starters/rust my-provider
   ```

   Or for Go:

   ```bash
   cp -R bookorbit-metadata-providers/starters/go my-provider
   ```

2. **Run it**, so you can see every endpoint working before you change anything. In Rust,
   `cargo run`; in Go, `go run .`. Then:

   ```bash
   curl "http://localhost:8080/search?query=earthsea"
   ```

3. **Name it.** Change `info()` in `src/main.rs` (Rust) or `main.go` (Go): give it your `name` and
   the `key` you chose.

4. **Connect your source.** In `src/source.rs` or `source.go`, replace the example with calls to
   your source:
   - Search returns matches best first, at most the query's limit.
   - Lookup returns the book for an id, or nothing (`None`, `nil`) when the id does not exist.
   - Return an error for anything else that goes wrong. Never hide a failure behind an empty list:
     to BookOrbit, an empty list means "this book is not there", and it remembers that.

5. **Check it against the contract.** With your provider running:

   ```bash
   cd bookorbit-metadata-providers/conformance && go run . -url http://localhost:8080 -query "Dune"
   ```

   It prints a line per check and ends with the number of failures and warnings. Fix every failure;
   each warning says what BookOrbit will do instead.

6. **Try it in BookOrbit.** Add it under **Settings > Metadata > Providers > External providers**
   with **Allow private address** on, choose **Test**, turn it on and search for a book.

## Recommendations

**Identity**

- Serve `/provider/info` with a `name`, a `key` and a `version`.
- Bump `version` whenever your answers change shape: new fields, different mapping, a fixed bug.
  BookOrbit keeps cached answers per version, so an unchanged version keeps serving old ones.
- Give it an icon (`avatarUrl`) and a `color`, so your results are recognisable at a glance.

**Answers**

- Put the best match first, and return a handful rather than everything: BookOrbit uses at most 50,
  and a person picks from the first few.
- Leave out what is not a book on a shelf: reviews, articles, interviews, collections pages.
- Support `GET /book/{id}` and declare `lookup: true` when your source has stable ids. Refreshing a
  book by id is faster and more accurate than searching for it again.
- Declare what you can fill with `supportedFields` and `mediaTypes`, so BookOrbit only asks you for
  what you have.
- Give each record its own `mediaType` when your source has more than one: a light novel is
  `book`, its manga `comic`. When titles are otherwise alike, BookOrbit prefers the record that
  matches the medium of the book being matched, so a novel's EPUB gets the novel.

**Data**

- Plain-text descriptions: strip HTML, Markdown and site markup, and keep paragraphs.
- Write people's names the way the book does. Give years as four digits, ISBNs without hyphens,
  ratings on a 0-5 scale.
- Return the largest cover your source has, with `coverWidth` and `coverHeight` when you know them.
- Fill only what you know. A missing field is better than a guessed one.

**Failures and limits**

- Answer `429` with `Retry-After` when your source throttles you. BookOrbit backs off.
- Answer `502` or `503` when your source fails. BookOrbit may then answer from its cache.
- Answer `"partial": true` when some matches could not be fetched, so the answer is not cached as
  complete.
- Pace your calls to the source inside the provider, whatever BookOrbit asks for: several BookOrbit
  servers, or other apps, may share one provider. Declare a `rateLimit` too, so BookOrbit does not
  queue more than you can serve.
- Identify yourself to the source with a `User-Agent` such as `my-provider/1.2.0`.

**Safety and privacy**

- Keep it stateless and read-only. It needs no database and no volume.
- Run as a non-root user in a minimal image (`scratch` or distroless). Both starters' Dockerfiles
  already do both.
- Support an `AUTH_TOKEN` (both starters do) for anyone who exposes it beyond their own network.
- Log failures, not the titles people look up.
- Say in your README which details you send to your source. BookOrbit sends you the title, author
  and ISBN of each book it asks about.

## Test it

- **Unit tests with real answers.** Save a few real responses from your source into `testdata/`,
  trimmed to the fields you read, and test your mapping against them. Tests then run offline and
  keep passing when the source is down. Both published providers do this.
- **The conformance checker** before every release: it checks the endpoints, types, limits, status
  codes, icon and colour the way BookOrbit reads them.
- **In BookOrbit:** **Test** in the provider's settings runs a real search and shows what came back.

## Package it

Ship it as a container image. Each starter's `Dockerfile` builds a static binary into an empty
`scratch` image that runs as a non-root user: about 1 MB for the Rust starter, 5 MB for the Go one.

```bash
docker build -t my-provider .
```

```bash
docker run --rm -p 8080:8080 my-provider
```

Build for both `linux/amd64` and `linux/arm64`: many people run BookOrbit on a Raspberry Pi or another
ARM machine.

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/your-name/my-provider:0.1.0 --push .
```

## Publish it

GitHub Container Registry (GHCR) is free for public images and sits next to your code.

1. **Push your code to GitHub.**
2. **Add a release workflow** as `.github/workflows/publish.yml`. Pushing a tag such as `v0.1.0` then
   builds both architectures and publishes the image:

   ```yaml
   name: Publish
   on:
     push:
       tags: ["v*"]
   permissions:
     contents: read
     packages: write
   jobs:
     publish:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: docker/setup-qemu-action@v3
         - uses: docker/setup-buildx-action@v3
         - uses: docker/login-action@v3
           with:
             registry: ghcr.io
             username: ${{ github.actor }}
             password: ${{ secrets.GITHUB_TOKEN }}
         - uses: docker/metadata-action@v5
           id: meta
           with:
             images: ghcr.io/${{ github.repository }}
             tags: |
               type=semver,pattern={{version}}
               type=semver,pattern={{major}}.{{minor}}
         - uses: docker/build-push-action@v6
           with:
             context: .
             platforms: linux/amd64,linux/arm64
             push: true
             tags: ${{ steps.meta.outputs.tags }}
             labels: ${{ steps.meta.outputs.labels }}
   ```

3. **Release:** bump `version` in `/provider/info`, then tag and push.

   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```

4. **Make the image public.** GitHub creates new packages as private. Open the package from your
   profile's **Packages** tab, then **Package settings > Change visibility > Public**.

5. **Write the README people need:** what the provider covers, a Compose snippet with a pinned
   version, the address to enter in BookOrbit, its environment variables, what it sends to its
   source, and any known gaps.

6. **Tell people about it** in a
   [Community Discussion](https://github.com/bookorbit/bookorbit/issues/new?template=discussion.yml).
   To have it offered under **Available to install** in every BookOrbit, open a pull request that
   adds it to `directory.json` in
   [bookorbit-metadata-providers](https://github.com/bookorbit/bookorbit-metadata-providers).

### Versions

Use semantic versions and tag each image with its full version (`0.1.0`), its minor line (`0.1`)
and, if you like, `latest`. Tell users to pin a version, so an update never surprises them.

Once people use your provider:

- Keep its key forever.
- Keep answering for ids you issued before. BookOrbit stores them on people's books and looks them
  up again on every refresh; an id that suddenly returns 404 tells BookOrbit the book is gone.
- Bump `version` with every change to your answers.

## Reference

The contract builds on the
[book-metadata-provider](https://github.com/FlyinPancake/book-metadata-provider) specification. Every
field below except `name`, `providerId` and `title` is optional.

### `GET /provider/info`

```json
{
  "name": "MangaBaka",
  "key": "mangabaka",
  "version": "0.1.0",
  "avatarUrl": "https://mangabaka.org/images/maomao/180x180.png",
  "color": "#e30047",
  "mediaTypes": ["book", "comic"],
  "lookup": true,
  "searchParams": ["limit"],
  "supportedFields": [
    "title",
    "description",
    "cover",
    "authors",
    "seriesName",
    "seriesIndex"
  ],
  "bookUrlTemplate": "https://mangabaka.org/manga/{id}",
  "idMaxLength": 12,
  "rateLimit": { "maxConcurrency": 1, "minIntervalMs": 2000 },
  "coverShape": "portrait"
}
```

| Field                    | What it does                                                                                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                   | Display name, up to 100 characters. Required                                                                                                                                                                                                                                  |
| `key`                    | Permanent identity: 2-32 lowercase letters, digits or hyphens, starting with a letter. Built-in names such as `goodreads` are taken. Defaults to a slug of `name`                                                                                                             |
| `version`                | Your release. Part of BookOrbit's cache key                                                                                                                                                                                                                                   |
| `avatarUrl`              | Your icon (see [Icon and colour](#icon-and-colour))                                                                                                                                                                                                                           |
| `color`                  | `#rrggbb` brand colour                                                                                                                                                                                                                                                        |
| `mediaTypes`             | Any of `book`, `audiobook`, `comic`. Defaults to `book` and `audiobook`                                                                                                                                                                                                       |
| `lookup`                 | `true` when you serve `GET /book/{id}`                                                                                                                                                                                                                                        |
| `searchParams`           | Optional search parameters you want: `isbn`, `limit`                                                                                                                                                                                                                          |
| `supportedFields`        | Field rules you can fill: `title`, `subtitle`, `description`, `cover`, `audioCover`, `authors`, `publisher`, `isbn`, `publishedYear`, `language`, `pageCount`, `communityRating`, `seriesName`, `seriesIndex`, `genres`, `narrators`, `duration`, `abridged`. Defaults to all |
| `bookUrlTemplate`        | A link to a book's page, with `{id}` in it, shown on the book                                                                                                                                                                                                                 |
| `idMaxLength`            | Longest id you issue, at most 512                                                                                                                                                                                                                                             |
| `rateLimit`              | `maxConcurrency` (1-4, default 2) and `minIntervalMs` (0-60000, default 0): how hard BookOrbit may call you                                                                                                                                                                   |
| `coverShape`             | `portrait` or `square`, when all your covers are one shape                                                                                                                                                                                                                    |
| `authenticationRequired` | `true` when your provider needs an `Authorization` header                                                                                                                                                                                                                     |

### `GET /search`

BookOrbit sends `query` (the title), `author` and `mediaType` (`book` or `audiobook`), plus `isbn` and
`limit` if you listed them in `searchParams`. It only searches when it has a title or an ISBN.

Answer with your matches, best first:

```json
{
  "matches": [
    { "providerId": "1692", "title": "BERSERK", "authors": ["MIURA Kentaro"] }
  ]
}
```

### `GET /book/{id}`

The `id` is one of your `providerId` values, URL-encoded. Answer with one book in the same shape as
a match, or `404` when it does not exist.

### A book

| Field                                | Notes                                                              |
| ------------------------------------ | ------------------------------------------------------------------ |
| `providerId`                         | Your id for it, a string. Required; a match without one is dropped |
| `title`                              | Required                                                           |
| `mediaType`                          | `book`, `comic` or `audiobook`: what this record is                |
| `subtitle`                           |                                                                    |
| `authors`, `narrators`               | Lists of names                                                     |
| `description`                        | Plain text, up to 50,000 characters                                |
| `publisher`                          |                                                                    |
| `publishedYear`                      | `"1968"`                                                           |
| `publishedDate`                      | `"1968-11-01"`                                                     |
| `languageCode`                       | `"en"`                                                             |
| `isbn13`, `isbn10`                   | Or a single `isbn` of either length                                |
| `pages`                              | Page count                                                         |
| `duration`                           | Audiobook length in seconds                                        |
| `genres`                             | List of names                                                      |
| `series`                             | `[{ "series": "Earthsea Cycle", "sequence": "1" }]`                |
| `cover`, `coverWidth`, `coverHeight` | A public `http(s)` image URL, and its size in pixels               |
| `rating`, `ratingCount`              | Community rating on a 0-5 scale, and how many people rated         |
| `url`                                | The book's page on your source                                     |

### Status codes

| You answer                            | BookOrbit                                                 |
| ------------------------------------- | --------------------------------------------------------- |
| `200`                                 | Uses the answer. An empty `matches` list means none found |
| `404` from `/book/{id}`               | Treats the id as gone                                     |
| `429` with `Retry-After`              | Waits that long before asking again                       |
| `401`, `403`                          | Reports the authorization header as refused               |
| Anything else, a timeout, or bad JSON | Counts a failure, and may answer from its cache           |

BookOrbit waits as long as the admin set for the provider: 10 seconds by default, between 2 and 30.
It reads at most 2 MB of an answer and the first 50 matches, and follows at most 3 redirects.

### Icon and colour

BookOrbit downloads the image at `avatarUrl` when the provider is added, tested, or rechecked every
six hours, and serves its own copy, so readers' browsers never contact you. It keeps PNG, WebP, JPEG,
GIF and ICO images up to 256 KB, judged by the file's contents; SVG is never kept. A square image of
64 pixels or more looks best. `color` must be six hex digits, such as `#2c98cd`, or BookOrbit ignores
it. Without an icon BookOrbit shows your initials; without a colour, a neutral one.

## FAQ

**Do I need to change BookOrbit?** No. An admin adds your provider by its address.

**Can one container serve several providers?** Yes. Serve each under its own path, such as
`http://pack:8080/goodreads/` and `http://pack:8080/audible/`, each with its own key, and add each
address separately.

**Can I see what BookOrbit asked?** Log the request path and status, not the query: the query is
someone's reading.
