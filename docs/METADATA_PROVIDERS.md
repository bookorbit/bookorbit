# External Metadata Providers

BookOrbit comes with its own metadata sources: Google Books, Goodreads, Hardcover and others. When
your library needs something they do not cover well, such as manga, Chinese books or Russian-language
science fiction, you can add an **external provider**: a small service that runs beside BookOrbit and
answers its metadata searches.

Once added, an external provider works like a built-in source. It shows up in manual search, Book
Dock, auto-fetch and library refresh, it can fill field rules, and it gets its own icon and colour
wherever it appears. Adding one needs no BookOrbit update.

## Ready-made providers

| Provider     | Good for                                                                                                                                   | Image                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Douban       | Chinese books from [book.douban.com](https://book.douban.com): titles, authors, publishers, ratings, ISBN lookups. No covers               | `ghcr.io/bookorbit/douban-provider`       |
| FantLab      | Russian-language science fiction and fantasy from [fantlab.ru](https://fantlab.ru): titles, authors, series, genres, ratings, ISBN lookups | `ghcr.io/bookorbit/fantlab-provider`      |
| J-Novel Club | Light novels and manga published in English by [J-Novel Club](https://j-novel.club). Reads the volume number from the book's title         | `ghcr.io/bookorbit/jnovelclub-provider`   |
| Libris       | Swedish books from [Libris](https://libris.kb.se), the National Library of Sweden's catalogue                                              | `ghcr.io/bookorbit/libris-provider`       |
| LubimyCzytac | Polish books from [lubimyczytac.pl](https://lubimyczytac.pl): titles, authors, series, genres                                              | `ghcr.io/bookorbit/lubimyczytac-provider` |
| MangaBaka    | Manga, manhwa, manhua and light novels from [mangabaka.org](https://mangabaka.org). Reads the volume number from the book's title          | `ghcr.io/bookorbit/mangabaka-provider`    |

Their source, and what each one returns, is in
[bookorbit-metadata-providers](https://github.com/bookorbit/bookorbit-metadata-providers). To make
your own, see [Building a Metadata Provider](BUILDING_METADATA_PROVIDERS.md).

### LubimyCzytac and Aladin used to be built in

Neither is built into BookOrbit any more. Nothing on your books is lost: their ids and links stay
where they were. Field rules that name either one skip it, and **Settings > Metadata > Providers**
says what to do.

- **LubimyCzytac** now runs as an external provider. Run its image and add it as below; field rules
  that name it pick up where they left off.

  ```yaml
  services:
    lubimyczytac:
      image: ghcr.io/bookorbit/lubimyczytac-provider:0.1.0
      restart: unless-stopped
  ```

- **Aladin** is retired. Aladin stopped issuing Open API keys on 4 September 2026 and ends the API on
  30 October 2026, with no replacement, so there is no provider to run. Take it out of your field
  rules. The Aladin key BookOrbit stored was deleted when it updated.

## Set one up

**Settings > Metadata > Providers** has two tabs: **Built-in** for the sources BookOrbit ships with,
and **External** for the ones you run. Under **Available to install**, the External tab lists the
ready-made providers with a **Copy Compose** button and an **Add** button that fills in the address
for you, so steps 1 to 3 below are mostly done for you.

1. **Run the provider next to BookOrbit.** Add it to the same Docker Compose file, so the two share
   a network. It needs no ports published and no volumes:

   ```yaml
   services:
     mangabaka:
       image: ghcr.io/bookorbit/mangabaka-provider:0.1.0
       restart: unless-stopped
   ```

   Start it with `docker compose up -d`.

2. **Add it in BookOrbit.** Open **Settings > Metadata > Providers > External** and choose **Add** on
   its card, or **Add provider** for one that is not listed. The address is the service name and
   port: `http://mangabaka:8080`.

3. **Turn on Allow private address.** A container beside BookOrbit is on a private network, and
   BookOrbit refuses private addresses unless you allow it for that provider. Leave it off for a
   provider hosted on the internet.

4. **Save, then choose Test.** A good test shows how many results a sample search found and how
   long it took. The provider appears in the list with its own icon.

5. **Turn it on.** It now answers manual searches: open a book, **Edit Metadata > Search**, and its
   results show beside the built-in sources.

6. **Let auto-fetch use it.** A new provider is in no field rule yet. Choose **Use in field rules** to
   add it to the end of every rule it can fill, or add it to individual rules yourself in
   **Settings > Metadata > Field Rules**. Move it up in the rules where it should win: for a manga
   library, MangaBaka belongs ahead of the general sources for title, series and cover.

### Tips

- **Pin a version** such as `0.1.0` rather than `latest`, and update on purpose. After updating,
  choose **Test** to pick up the new version straight away; otherwise BookOrbit notices within six
  hours.
- **Keep it private.** A provider only has to be reachable from BookOrbit. Do not publish its port to
  the internet unless you also set its `AUTH_TOKEN` (see its README) and enter the same value in
  BookOrbit's **Authorization header** field.
- **Authorization headers are stored encrypted** with `BOOK_REQUEST_ENCRYPTION_KEY`, the same key
  book requests use (see `server/.env.example`). If that key changes, the provider shows **Header
  unreadable** and is skipped until you enter the header again.
- **More than one at once is fine.** Each provider has its own key, ids and ratings, and BookOrbit
  asks each at the pace it asks for.

## What a provider can see

BookOrbit sends a provider the title, author and ISBN of each book it asks about, and the provider's
own id for a book it has already matched. It sends nothing else about your library or your users.
A provider passes those details on to the service it gets its data from, so a provider for a public
site means that site sees which books you look up.

The list under **Available to install** is read from the
[bookorbit-metadata-providers](https://github.com/bookorbit/bookorbit-metadata-providers) repository
on GitHub, at most once a day and only when an admin opens the External tab. To keep BookOrbit from
contacting GitHub for it, set `METADATA_PROVIDER_DIRECTORY_URL=off`; the list that came with your
version is shown instead.

## Status

| Status            | What it means                                                                     |
| ----------------- | --------------------------------------------------------------------------------- |
| Ready             | Working, but turned off                                                           |
| Active            | Working and turned on                                                             |
| Last check failed | The six-hourly check failed; it keeps answering with what it last reported        |
| Unreachable       | Three checks in a row failed; it is skipped until one succeeds. Choose **Test**   |
| Key changed       | The provider now reports a different identity. Remove it and add it again         |
| Incompatible      | Something answered at that address, but not a metadata provider BookOrbit can use |
| Header unreadable | The saved authorization header can no longer be decrypted. Enter it again         |

## Removing a provider

**Remove provider** keeps the ids and ratings it stored on your books and its place in field rules,
so adding it again later picks up where it left off. **Remove and delete its data** also deletes those
ids, ratings and its cached answers.

## Troubleshooting

- **"That address is on a private network"**: turn on **Allow private address** for it.
- **"Could not reach a provider at that address"**: the address is what BookOrbit, not your browser,
  can reach. Inside Docker that is the service name (`http://mangabaka:8080`); `localhost` would be
  the BookOrbit container itself. Check the provider is running with `docker compose ps`.
- **"Answered, but not with usable provider info"**: the address is wrong or points at something
  else. Open `<address>/provider/info` from the BookOrbit host; a provider answers with JSON that has
  a `name`. A missing or extra path in the address is the usual cause.
- **"A provider with the same key is already registered"**: that provider is already added. Each
  provider can be added once.
- **Two providers show the same name**: BookOrbit adds the host, such as "FantLab (fantlab:8080)", so
  they can be told apart.
- **No results for a book you know is there**: the provider searches by title and author as they are
  in BookOrbit. For MangaBaka, a title like "Berserk Vol. 3" works; for FantLab, Russian titles find
  more than English ones.
