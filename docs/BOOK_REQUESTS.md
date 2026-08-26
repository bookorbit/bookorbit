# Book Requests

Book requests let readers ask for a book BookOrbit does not have. An approver decides on the
request, a release is picked from the sources you configured, a download client fetches it, and the
result is filed into a library.

Everything in this guide is operator configuration. Nothing here is on by default, and a fresh
install has no sources, no download clients and no automation.

## What BookOrbit ships

**BookOrbit ships no sources.** There is no bundled tracker, no default indexer, and no list of
sites to pick from. One adapter type is compiled in, `torznab`, and it is a protocol rather than a
source: it needs an address you supply, usually a Prowlarr or Jackett instance you run. Everything
else is an indexer plugin you install yourself.

Which sources you point BookOrbit at, and what you search for and download through them, is your
decision and your responsibility. BookOrbit does not provide or endorse indexer sources. Its URL,
file, and path safety checks still apply to every configured source.

## Permissions

| Permission                  | What it allows                                              |
| --------------------------- | ----------------------------------------------------------- |
| `book_request_access`       | File a request, see your own, join somebody else's          |
| `manage_book_requests`      | Approve, reject, and drive fulfilment on every request      |
| `book_request_auto_approve` | Your own requests skip the approval queue                   |
| `book_request_self_fulfill` | Pick the release and download it yourself, with no approver |

The last three each imply `book_request_access`; granting one on its own would produce an account
that can approve requests but has no page to see them on.

Configuring sources, download clients and automation is separate again, and needs
`manage_app_settings`. Installing an indexer plugin needs a superuser: a plugin runs inside the
server process with the server's reach.

## Before anything can be saved: the encryption key

Set `BOOK_REQUEST_ENCRYPTION_KEY` before configuring a download client or an indexer:

```bash
openssl rand -hex 32
```

It must be a 64-character hex string. Unlike `MIGRATION_ENCRYPTION_KEY` and the email key, this one
is not optional in practice: a tracker API key or seedbox password is **refused rather than stored
in the clear** when the key is missing, so the settings form will not save.

Rotating or removing the key leaves stored credentials unreadable. They are not silently dropped:
the affected source refuses to be used and says why, so you can re-enter the credential rather than
discover the loss during a download.

## Sources

Settings > System > Requests > Sources.

Two kinds of row, added two ways, identical once they exist:

- **Torznab**: an address plus an API key. This is how you attach a Prowlarr or Jackett instance,
  and one such instance can expose many trackers behind one row per tracker.
- **Plugins**: a single `.mjs` file installed through the page, loaded at boot from
  `<APP_DATA_PATH>/plugins/indexers/<name>/index.mjs`. Plugins live in their own repositories and
  are not distributed with BookOrbit.

Per source you can set the medium it is searched for, its categories, whether it is handed an ISBN
when the request has one, and a colour that marks its releases in the release picker.

Private network addresses are refused unless you opt the row in with **Allow private address**. A
self-hosted Prowlarr on the LAN is the common reason to; a public tracker resolving to a private
address is not.

Two health facts are shown per row, and they answer different questions:

- **Connected / Not reachable** is the last time you pressed **Test**, which makes a capabilities
  call.
- **Searches failing** is how the last real searches went. A source can be reachable and still
  refuse every search, and the badge counts consecutive failures so one blip reads differently
  from a source that has been broken for a week.

## Download clients

Settings > System > Requests > Download clients. qBittorrent, Transmission and Deluge are
supported.

Each client needs at least one **path mapping**, including when BookOrbit and the client run on the
same host. A mapping translates the download directory the client reports into a path BookOrbit can
open, and it is also the root the import is allowed to read out of. On a single host that mapping
is an identity, `/downloads -> /downloads`; it still has to be stated, because "the same path" and
"no path stated" are different things and only one of them is safe to import from.

Hardlinking from the download directory into the library is what keeps a torrent seeding after the
book is filed. The mapping form can test whether a hardlink actually works between the two paths,
which is worth doing before the first grab: a mapping across filesystems copies instead, silently
doubling the space every book takes.

BookOrbit never stops a seed on its own. Removing a torrent from its client is an explicit action
with its own confirmation, and removing one that is still working also fails the request.

## Automation

Settings > System > Requests > Automation. Everything here is off or unset by default.

- **Auto-grab** picks a release without an approver, but only above a minimum score. Below that the
  request waits, and the approver still sees the full ranked list.
- **Auto-retry** falls back to the next-best release when an automatic grab fails, bounded by a
  maximum number of attempts per request.
- **Auto-search** re-searches an approved request nothing was found for. Without it a request is
  searched exactly once, and a book whose first release is posted next month waits forever. The
  interval doubles for each week a request has been waiting, up to a cap, and stops entirely after
  a configurable age.
- **Import checking** scores what landed against what was asked for. Below the threshold the file
  waits in the Book Dock and the request reads "needs review", where a person either files it
  anyway or discards it. Switching this off files whatever was downloaded straight into the target
  library.
- **Import formats** decides what to keep when one release carries the same book several times
  over: every format, or only the target library's preferred one. A multipart audiobook is never
  affected, since its parts are one book rather than competing editions.
- **Default destinations** are per medium, and are the lowest rung of the ladder: a requester's own
  pinned destination and an explicit choice at request or approval time both win over them. Without
  one, a request that names no library can never be approved.
- **Release profiles** are an ordered tier list per medium describing the edition you want. Empty
  is the ordinary state and disengages the tier axis entirely, leaving auto-grab decided by score.

## The lifecycle

```
pending -> approved -> searching -> grabbed -> downloading -> importing -> available
```

- **pending**: waiting on an approver. Auto-approval and self-serve both skip it.
- **needs_review**: the import scored below the threshold and is sitting in the Book Dock. Two ways
  out: file it anyway, or discard it, which removes the dock entry and fails the request.
- **failed**: nothing could be downloaded, or a person discarded the import. Still grabbable, so a
  different release can be tried.
- **rejected** / **cancelled**: settled by a person. A settled work can be requested again.

One live request per work. A second person asking for the same book is attached to the existing
request as a subscriber rather than opening a second one, and can leave it again from the request's
own menu.

## Troubleshooting

**"No sources are enabled"** on the requests page: either nothing is configured, or every row is
switched off. The notice says which.

**Requests sit at `approved` and nothing happens**: auto-grab is off, which is the default. Either
an approver opens the release picker, or auto-grab is switched on with a minimum score.

**A grab is refused with a path error**: the client has no path mapping, or the download directory
resolved outside the one it has. Add or widen the mapping under Settings > System > Requests.

**Credentials will not save**: `BOOK_REQUEST_ENCRYPTION_KEY` is unset or is not 64 hex characters.

**A source shows "Searches failing" but tests fine**: the address answers a capabilities call and
refuses searches. Usually a rate limit, an expired session, or categories that do not exist on that
tracker.

## Related

- [Development guide](DEVELOPMENT.md)
- [Testing guide](TESTING.md)
