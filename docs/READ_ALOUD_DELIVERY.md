# Read-aloud EPUB delivery

Read-aloud delivery applies to EPUB publications with supported media overlays. It does not change the stored source, the primary library file, or the web/iOS reader and narration resources.

Each delivery has a selected source, a requested policy, and an actual artifact. Original delivery sends the stored bytes unchanged. Text-only delivery removes supported narration and overlays while preserving the spine and sentence anchors. Plain EPUBs can satisfy text-only requests with unchanged bytes. The response reports the actual variant separately from the requested policy.

## Destination choices

| Destination    | Preference                                    | Original behavior                                                                                                                                     |
| -------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kobo           | Per BookOrbit user                            | Narrated EPUB bypasses KEPUB conversion. Percentage/status sync remains available; precise positions and highlights need a supported KEPUB rendition. |
| OPDS           | Per credential                                | Narrated EPUBs are available alongside plain siblings and rank first among EPUB acquisition links.                                                    |
| KOReader       | Server credential default and device override | Single and bulk downloads capture one variant. A single download can override either default.                                                         |
| Ordinary email | Per recipient                                 | Automatic EPUB selection prefers narration. Explicit file IDs and non-EPUB format preferences still win.                                              |
| Kindle email   | Per recipient                                 | Original is unavailable. New UI configurations choose explicit text-only.                                                                             |
| Web download   | Per action                                    | The ordinary original-download route retains its original meaning. The text-only action is strict.                                                    |

New OPDS and email configurations and first-device Kobo setup default to explicit text-only in the supported web interface. Existing destination rows inherit their previous behavior. Inherited Kobo, OPDS, and email delivery may fall back to original bytes if preparation fails, including the historical Kindle exception. Explicit text-only requests fail instead. Editing unrelated settings preserves inheritance and existing explicit choices. Omitting a preference preserves it; setting the nullable preference to null restores inheritance.

Changing a preference affects future acquisitions. It does not replace an existing device copy or change an issued transfer, queued send, or retry.

## Transfer identity and recovery

New acquisition links carry an authenticated selection descriptor. Every use still checks credential validity, ownership, permissions, and library access. The descriptor binds the source content version, policy, and transformer version. Preparation validates recorded file stats, computes a full source digest, and seals the actual outcome. Subsequent transfers require the captured digest and outcome, including an inherited original fallback. A changed source or unavailable historical artifact requires a fresh acquisition.

Transfers expose measured length, an artifact-specific SHA-256 ETag, and byte ranges. An `If-Range` mismatch returns a full response. Clients must discard their partial download before accepting it. KOReader uses staged full-download restart rather than byte-range continuation, verifies the received fingerprint, and publishes atomically. Bulk checkpoints also include the server/account and variant; old checkpoints restart safely.

Inspection is lazy and keyed to the full source digest and detector version. Failed inspection has a five-minute backoff. Legacy negative metadata is not accepted as proof that an explicit text-only request is safe. Unsupported encryption, signatures, multimedia, unsafe archive names, incomplete overlay graphs, and resource-limit failures are rejected. Original delivery does not require successful narration inspection.

Derivatives and KEPUB conversions have bounded preparation queues and disk retention. Active leases protect files used by streams or position conversion. Eviction does not erase delivery provenance. Equivalent regeneration must match the recorded full digest; unavailable historical precision preserves canonical state rather than interpreting old spans against a different file. Fingerprint retry markers are durable and replay in bounded batches without changing manual hash links or resolving ambiguous identities arbitrarily.

KOReader annotation and bookmark exchange acknowledgements are scoped to the device and rendition hash. Opening an original and a text-only copy on one device cannot make either sidecar's missing entries delete the other's annotations. Historical hashes whose source bytes are unavailable cannot exchange or acknowledge precise annotations and bookmarks.

Closed-book highlight writes remain pending until verified by the live reader. Missing unverified entries are redelivered with their complete ranges and cannot imply a server deletion. When several existing local files share one rendition hash, the sweep selects the most recently opened copy and withholds missing-key deletion detection for both highlights and bookmarks. Independent deletions between identical local copies are unsupported; deleting in BookOrbit remains authoritative.

The web reader requests positions for its selected file, verifies highlight quotes, and projects bookmark points using recorded source-file provenance and equivalent chapter text. These projections do not replace canonical positions. Existing API clients retain the default response behavior; selected-file projection uses an optional query parameter. A failed device apply keeps the annotation eligible for retry without invalidating another device's canonical anchor.

## Guided Kobo replacement

Search for one book and select one device. Prepare the replacement before removing the device copy. Review its format and measured size, remove the book only from the selected device, offer the replacement, and sync/download. Open it on the device before confirming installation.

Preparation and cancellation before offering preserve the previous delivery context. After offering, old and new device events may be ambiguous, so precise conversion degrades instead of guessing. Canonical progress and server-held annotations remain available. Unattributable backwards replacement events are retained in device state but cannot lower canonical progress or change read status. The next sync offers the saved percentage again. Forward percentage updates remain available; deliberately restarting an ambiguous replacement requires saving the reset in BookOrbit first. Backwards reading on a known unchanged copy remains supported. Device-local annotations are not promised to be backed up. Cancellation does not restore a removed or partly replaced copy; prepare a recovery download explicitly.

A completed HTTP transfer is evidence of server transfer completion, not device installation. Guided confirmation records the user's confirmation. Automated removal, replacement, and installation acknowledgment remain disabled until separate protocol and real-device validation succeeds.

## Email dispatch

Queued sends capture recipient/device type, policy, selected file, and source digest. Prepared retries and manual resends retain the artifact metadata and full digest. Changed preferences do not alter the attachment. A fresh send uses current settings; legacy logs retain legacy resend behavior.

Preparation errors are recorded in send logs. Process restart marks interrupted pending sends failed for explicit review. SMTP DATA ambiguity and a failure after SMTP acceptance do not automatically resend the attachment. SMTP acceptance, logging, and notifications are separate boundaries; exactly-once SMTP delivery is not promised.

User-authored subject/body templates remain unchanged. Server-authored delivery notifications use the application's documented English fallback; an external recipient address does not determine the BookOrbit notification locale. OPDS acquisition labels also use English fallback. Web interface copy uses the complete English catalog and translated fallback mechanism.

## Client compatibility and rollout

| Combination                                | Behavior                                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Released iOS or old web/plugin, new server | Existing routes, response fields, and old payloads retain their meaning. New preference fields are optional.                             |
| New web/iOS, old server                    | New inputs are omitted unless `read-aloud-delivery` is advertised by app-info.                                                           |
| New plugin, supported server               | `readAloudDeliveryVariants` covers detail, manifest, download, naming, and checkpoint identity.                                          |
| New plugin, unsupported or unknown server  | An explicit original or override fails visibly; legacy default acquisition remains available. Saved preferences are retained.            |
| Old client changes recipient to Kindle     | The incompatible stored original preference becomes text-only without rejecting the old payload. A newly requested original is rejected. |

Apply the additive database migrations before enabling the new capabilities. Existing preferences remain inherited. Retain original files and provenance tables across upgrades. The first application release containing this feature is the minimum version that can safely interpret mixed device renditions. Rolling back earlier requires a matching application/database backup from before mixed delivery was enabled; an old application cannot safely interpret the new provenance.

The `read-aloud-delivery` E2E suite covers bytes, ranges, authorization, independent profiles, update semantics, the large-source/small-derivative path, and guided replacement. Existing Kobo, KOReader, OPDS, email, reader, and authorization suites cover their surrounding contracts. Live KOReader simulator checks exercise real server transfers and the real rendering engine. The suite also uses live HTTP sockets to verify initial saved progress, percentage fallback without precise conversion, delayed replacement resets, explicit resets, and deliberate backwards reading. Simulator and HTTP evidence do not verify native Kobo installation or narration playback on physical hardware.

## KOReader server defaults

Set the credential default in Settings > KOReader > Sync Settings > KOReader EPUB delivery. A device can override it, or use the credential default. New credentials created in the supported web interface start with text-only delivery. Existing credentials inherit text-only until configured; the plugin imports an existing local choice once for that device if the server default has not been configured. Import never overwrites a saved device choice or an explicit credential default.

Plugin 1.7.0 reads the current server preference before a fresh acquisition. Download > Settings > Read-aloud EPUB delivery edits the same server device setting. Single-download options include Use BookOrbit default and a choice of either EPUB variant. Changes apply to future acquisitions. Issued selections and interrupted bulk checkpoints retain their captured variant, including when a web default changes before resume.

The `koreader-delivery-settings` web feature and `readAloudDeliverySettings` plugin capability gate the new fields and routes. Against older servers, the plugin retains its local default and explicit override compatibility. A failed or invalid settings response does not silently select a different rendition. Credentials remain unique per BookOrbit account; devices sharing them may have independent overrides.
