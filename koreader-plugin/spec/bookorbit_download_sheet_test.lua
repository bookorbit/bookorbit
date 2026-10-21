-- The download sheet lists editions, not files: a read-along EPUB is two
-- (text only, and with its narration), a plain file is one, and each says
-- what it is and how big it will be when that is known.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local function identity(value) return value end
package.loaded["gettext"] = identity
package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index) return tostring(values[tonumber(index)]) end))
    end,
}
package.loaded["ui/uimanager"] = {}
package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }
package.loaded["bookorbit_board_metrics"] = { INK = {}, px = identity }
package.loaded["bookorbit_board_ui"] = {}
package.loaded["bookorbit_catalog_util"] = {
    formatBytes = function(n) return n and (math.floor(n / 1024 + 0.5) .. " KB") or "" end,
    safeFilenameBase = function(detail) return detail.title end,
}
package.loaded["bookorbit_dialog_ui"] = {}
package.loaded["bookorbit_menu_ui"] = {}

local DownloadSheet = require("bookorbit_download_sheet")

local function assertEqual(actual, expected, label)
    if actual ~= expected then error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual))) end
end

-- The Ocean at the End of the Lane on the dev server: a plain EPUB and the
-- read-along EPUB, delivered text only by default.
local plain = { id = 1059, format = "epub", sizeBytes = 312287, sourceSizeBytes = 312287, downloadVariant = "audioless_epub", sourceMediaOverlayAvailable = false }
local readalong = { id = 1074, format = "epub", sizeBytes = nil, sourceSizeBytes = 166558581, downloadVariant = "audioless_epub", sourceMediaOverlayAvailable = true }
local editions = DownloadSheet.editions({ plain, readalong })

assertEqual(#editions, 3, "a plain EPUB and a read-along EPUB make three editions")
assertEqual(editions[1].label, "EPUB", "a plain EPUB is just an EPUB")
assertEqual(editions[1].sub, "The ebook, 305 KB", "with its size")
assertEqual(editions[1].variant, "audioless_epub", "and the delivery it was asked for")
assertEqual(editions[2].label, "Read-along EPUB, text only", "the read-along EPUB without its narration")
assertEqual(editions[2].sub, "Narration taken out, so it stays small", "its size is not known until it is built")
assertEqual(editions[3].label, "Read-along EPUB with narration", "and with it")
assertEqual(editions[3].sub, "Includes the audio, 162655 KB", "whose size is the stored file's")
assertEqual(editions[3].variant, "original", "asked for as the original")

-- Delivered with narration, the sizes swap sides.
local original = { id = 1074, format = "epub", sizeBytes = 166558581, sourceSizeBytes = 166558581, downloadVariant = "original", sourceMediaOverlayAvailable = true }
local swapped = DownloadSheet.editions({ original })
assertEqual(swapped[2].sub, "Includes the audio, 162655 KB", "a delivered original knows its size")

-- The sheet starts on the file and form it was opened for.
assertEqual(DownloadSheet.indexOf(editions, 1074, "original"), 3, "the narration form of the read-along file")
assertEqual(DownloadSheet.indexOf(editions, 1074, "audioless_epub"), 2, "its text-only form")
assertEqual(DownloadSheet.indexOf(editions, 1059, "audioless_epub"), 1, "the plain EPUB")
assertEqual(DownloadSheet.indexOf(editions, 9999, nil), 1, "an unknown file falls back to the first edition")

-- Other formats say what they are.
local pdf = DownloadSheet.editions({ { id = 7, format = "pdf", sizeBytes = 2048 } })
assertEqual(pdf[1].label, "PDF", "a PDF is labelled by its format")
assertEqual(pdf[1].sub, "Fixed pages, 2 KB", "and what that means")

print("bookorbit_download_sheet_test.lua: ok")
