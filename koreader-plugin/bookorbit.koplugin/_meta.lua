local _ = require("gettext")
return {
    fullname = _("BookOrbit Sync"),
    description = _([[Synchronizes reading progress, book status, ratings, reading statistics and highlights to a BookOrbit server. Highlights sync two ways: notes, edits and deletions made in the BookOrbit web reader appear on this device and vice versa. The open book syncs automatically on close and suspend; the whole library syncs on demand.]]),
}
