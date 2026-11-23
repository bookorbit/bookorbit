# Jobs

The Jobs page lists long-running work from across BookOrbit in one place: what is running, what is waiting and in what order, what needs an answer, what failed, and what finished. Open it from **Jobs** in the sidebar, or at `/jobs/activity`.

## Sidebar entry

The **Jobs** entry in the sidebar reflects the viewer's own jobs, so it is quiet unless something of theirs is going on:

- **Running:** the icon glows softly. With reduced motion turned on, it holds a steady tint instead.
- **Waiting or paused only:** the icon holds a steady tint, without the glow.
- **Needs you:** a count shows how many jobs wait on the viewer. In the collapsed sidebar, where there is no room for the count, a dot stands in for it.
- **Failed:** a small red mark shows while the viewer has failed jobs that are still listed under **Failed**. Dismissing them, or their moving to History, clears it; opening the page does not.

Hovering the entry lists what is behind the signal, such as "2 running" or "1 job needs you". Work that belongs to no one, such as a library scan or the metadata auto-fetch queue, never lights the entry; for someone who can see it in Jobs, the tooltip names it as "Also running". On a phone, a dot on the menu button shows when a job needs the viewer; failures alone do not light it.

The entry stays lit on the Jobs page itself. It updates when a job starts, ends or changes state, never on progress alone.

## Views

| View          | What it lists                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Queue**     | Running, waiting and paused work. A waiting job shows its place, such as "#2 in read-alouds".                                                                                                      |
| **Needs you** | Work that is waiting on a person: a read-aloud to review, a download to review before import, chapter lookups to check. In the everyone scope this view is called **Needs review**.                |
| **Failed**    | Work that stopped on an error and has not been dismissed. Each type keeps failures here for a while (7 days for most types, 30 days for story guides and bulk actions), then they move to History. |
| **History**   | Finished, cancelled, dismissed and older failed work, grouped by day.                                                                                                                              |

Each row links to where its subject lives, such as the book's page or the request, which is where a review is answered.

The **type filter** narrows every view to one type and only offers the types the viewer can see. **Mine** and **Everyone's** switch between the viewer's own jobs and every account's; the switch appears only for those who may see other accounts' jobs of at least one type. The view, type and scope are kept in the address, so a link such as `/jobs/activity?view=failed&type=bulk-run` opens that list directly.

## Who sees what

Holding any permission in the table opens the page. Each type then decides which of its rows a person sees: their own jobs with the first permission, and every account's with the second. Superusers see everything.

| Type                | Own jobs                                      | Every account's                   |
| ------------------- | --------------------------------------------- | --------------------------------- |
| Story guide         | Build story guides, while story guides are on | App settings                      |
| Read-aloud          | Generate read-aloud books                     | App settings                      |
| Book merge          | Merge books                                   | App settings                      |
| Chapters            | Edit metadata                                 | App settings                      |
| Chapter lookup      | Edit metadata                                 | App settings                      |
| Duplicate scan      | Delete books, or Merge books                  | App settings                      |
| Request download    | Download books directly                       | Manage book requests              |
| Library scan        | None                                          | Manage libraries, or App settings |
| Metadata auto-fetch | None                                          | Metadata config, or App settings  |
| Author enrichment   | None                                          | Metadata config, or App settings  |
| Bulk action         | Edit metadata                                 | App settings                      |

A row about a book the viewer can no longer reach is listed without the book's title, cover or link. Library scans and chapter lookups only cover libraries the viewer can reach. The metadata auto-fetch and author enrichment queues appear as summary rows, and chapter lookups as one row per account in each view, rather than a row per book or author.

## Actions

A row offers only what the viewer may do to it now: cancel, pause, resume, try again, continue, dismiss, move to the top of their own jobs, or move ahead of everyone (managers only, read-aloud). When a row offers nothing, a short note says why. Selecting several rows offers every action that at least one of them allows; each action is taken only on the rows that allow it, and the button shows how many that is when it is not all of them. Cancelling always asks first.

## Bulk actions

These run on the server and continue after the tab that started them is closed:

- Refresh metadata, re-extract covers and embed audiobook covers for selected books
- Refresh metadata for selected authors
- Move books to another library

The toolbar shows the progress of a run started in the current tab, with **Cancel** and an option to keep it running in the background. Every run, from any tab or device, is listed in Jobs under **Bulk action**.

- **One at a time per account.** Each account's runs wait in their own line and accounts take turns, so one account's large run does not hold up everyone else. `BULK_RUNS_MAX_CONCURRENT` (default 3) caps how many run at once across the server.
- **Up to 10 unfinished runs per account.** Starting an eleventh answers `429 Too Many Requests` until one finishes.
- **Cancel** stops a run within one item. Items already done stay done.
- **Server restarts.** A run that was going when the server stopped is marked interrupted and offers **Continue**, which picks up where it stopped. A book move can continue once the server has finished rescanning the libraries it involves after the restart. Interrupted runs are dismissed after 30 days.
- **Permissions are checked as it runs**, at least every 30 seconds. A run stops if the account that started it loses the permission, becomes a demo account or is removed, or, for a run started with an API key, if the key is revoked or expires.
- **History.** Finished runs are deleted after 90 days.
- **Notifications.** A run that finishes after its tab was closed, or after **Keep running in the background**, sends a notification, with a warning when some items failed. A run the tab watched to the end sends none, since the tab already showed the result. A run that stops on its own, or that a restart cuts short, always sends one; a cancelled run never does. A finished book move keeps its existing notification under **Bulk rename**. These can be turned off under **Bulk actions** in the notification settings.

### Starting a bulk action from a script

The bulk routes accept an [API key](API_KEYS.md) with write access and the matching permission. Each answers with a server-sent event stream that reports progress, and names the run in the `X-Bulk-Run-Id` response header. Disconnecting from the stream does not cancel the run.

| Route                                        | Run                           |
| -------------------------------------------- | ----------------------------- |
| `POST /api/v1/books/bulk-refresh-metadata`   | Refresh book metadata         |
| `POST /api/v1/books/bulk-re-extract-cover`   | Re-extract covers             |
| `POST /api/v1/books/bulk-embed-audio-cover`  | Embed audiobook covers        |
| `POST /api/v1/authors/bulk-refresh-metadata` | Refresh author metadata       |
| `POST /api/v1/books/move`                    | Move books to another library |

The Jobs routes themselves (`/api/v1/jobs`) are for signed-in sessions only in this release, so a run started by a script is followed and cancelled from the Jobs page.
