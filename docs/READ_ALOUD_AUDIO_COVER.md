# Audiobook cover in a read-along EPUB

A read-along EPUB is read and listened to alike, but it carries one cover: the portrait book cover. In a square grid, or on a player screen such as iOS Now Playing, that portrait cover looks out of place. BookOrbit keeps a separate square audiobook cover for such a book, and a read-along EPUB can carry that cover inside the file.

## Where the audiobook cover comes from

A book has two cover slots, Book (2:3) and Audiobook (1:1). The Audiobook slot of a read-along EPUB with no audio file fills from the first of these:

1. The audiobook cover the EPUB declares, described below.
2. A square image in the book's folder, such as `cover.jpg`.
3. The Audiobook cover metadata fetch rule, or an upload in the cover editor.

The EPUB's own book cover is never copied into the Audiobook slot. Until the slot is filled, audio screens show the book cover with a blurred fill.

## What a book shows by default

A book whose primary file is a read-along EPUB shows the slot that matches its library's grid shape: the Audiobook cover in a square library, the Book cover in a portrait one. While the Audiobook slot is empty, a square library shows the book cover in its portrait frame.

## The declaration

An EPUB holds one `cover-image`, so the audiobook cover is a separate manifest image that carries Storyteller's `audio-cover-image` property. It is the same convention Storyteller writes into the read-along EPUBs it builds (its vocabulary, section 3.1), so a file made by either tool works in both:

```xml
<package version="3.0" prefix="storyteller: https://storyteller-platform.gitlab.io/storyteller/docs/vocabulary">
  <manifest>
    <item id="cover" href="cover.jpeg" media-type="image/jpeg" properties="cover-image"/>
    <item id="audio-cover-image" href="images/audio-cover.jpg" media-type="image/jpeg" properties="storyteller:audio-cover-image"/>
  </manifest>
</package>
```

- The image must be JPEG, PNG, GIF or WebP, no larger than 32 MiB, and not the book's own cover. A property on the `cover-image` item is ignored. BookOrbit re-encodes anything else as JPEG when it writes one.
- Only the property counts. An image is never taken for the audiobook cover because of its shape or name. BookOrbit's own cover lookups skip an item that carries the property, so an image named `audio-cover` is not mistaken for the book cover.
- Other readers ignore the property and the extra image, so the file stays a valid read-along EPUB.
- BookOrbit reads the property when it scans a book and when a cover is re-extracted. An audio file in the book takes precedence for the Audiobook slot.

A tool that builds read-along EPUBs only has to add that one manifest item, and declare the `storyteller` prefix on the package, to have its square cover picked up.

## Embedding the cover

A cover that came from somewhere else can be written into the EPUB, so it travels with the file. Use **Embed in read-along EPUB** on the Audiobook tile of the cover editor, or **Embed audiobook covers in read-along EPUBs** on a selection of books. Both need the Edit metadata permission.

- Nothing is written automatically.
- The library must allow writing to read-along EPUBs and the file must be within that library's size limit. The library's automatic write-back switch does not apply.
- An audiobook cover the file already carries, for example one Storyteller wrote, is replaced where it lies, so the file never holds two. Otherwise one manifest item and the package's `storyteller` prefix are added.
- Only EPUB 3 packages are written, which is every read-along EPUB.
- The file is copied entry by entry without recompressing, and replaced only once the copy is complete. A 1.5 GB EPUB takes a few seconds and needs that much free space beside it.
- A file that already holds the same image is left alone. Metadata and the book cover are never touched.
- The file's KOReader hash changes, as with any metadata write, and BookOrbit keeps the old one in its hash history so a device that holds the old copy still matches the book. A tool that syncs the folder will upload the file again.

## Read-along EPUBs BookOrbit generates

A read-along EPUB that a read-aloud job generates carries the book's audiobook cover from the start: the job writes it into the file just before the file is added to the book, so no manual embed is needed for new files. The library's write settings do not apply to that, because the file is not in the library yet, and the file has no hash history to keep. When the book has no audiobook cover, or the write fails, the file is published without one and the job's activity log says why. See [READ_ALOUD.md](READ_ALOUD.md).
