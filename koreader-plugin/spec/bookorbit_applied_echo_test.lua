-- A change the server applies to the open book carries the server's stamp,
-- newer than the upload watermark taken from the list read before the pull.
-- The next exchange used to send that copy straight back (S-30). It stays home
-- now, while a change the reader makes to it afterwards still goes up.

package.loaded["docsettings"] = {
    open = function()
        return { readSetting = function() return {} end, saveSetting = function() end, makeTrue = function() end, flush = function() end }
    end,
    hasSidecarFile = function() return false end,
    findSidecarFile = function() return nil end,
}
package.loaded["ui/widget/booklist"] = { setBookInfoCacheProperty = function() end }
package.loaded["ui/event"] = { new = function(_, name, payload) return { name = name, payload = payload } end }
package.loaded["ui/uimanager"] = { setDirty = function() end }
package.loaded["logger"] = { dbg = function() end }
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["util"] = {
    trim = function(value) return tostring(value or ""):match("^%s*(.-)%s*$") end,
}
package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitAnnotations = require("bookorbit_annotations")
local BookOrbitSidecar = require("bookorbit_sidecar")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local local_item = {
    datetime = "2026-07-08 09:00:00",
    drawer = "lighten",
    color = "yellow",
    text = "kept highlight",
    note = "web note",
    page = "/body/p[2]/text().0",
    pos0 = "/body/p[2]/text().0",
    pos1 = "/body/p[2]/text().14",
}

local ui = {
    rolling = true,
    document = {
        file = "/books/one.epub",
        isXPointerInDocument = function() return true end,
        getTextFromXPointers = function() return "kept highlight" end,
    },
    annotation = { annotations = { local_item } },
    handleEvent = function() end,
}

-- Server time for the recolor done on the web, minted in the device's clock.
local server_stamp = os.date("%Y-%m-%d %H:%M:%S", os.time() - 60)
local book = { annWatermark = "2026-07-08 10:00:00" }
local pending_edit = {
    edit = {
        {
            serverId = 7,
            version = 2,
            datetime = local_item.datetime,
            datetimeUpdated = server_stamp,
            drawer = "lighten",
            color = "purple",
            text = "kept highlight",
            note = "web note",
            pos0 = local_item.pos0,
            pos1 = local_item.pos1,
        },
    },
}

local function exchange(to_apply)
    local normalized, max_datetime, signature = BookOrbitSidecar.normalizeAnnotations(ui.annotation.annotations)
    local uploads, served = {}, false
    local result = BookOrbitAnnotations.exchangeBook({
        client = {
            exchangeAnnotations = function(_, books)
                for _, change in ipairs(books[1].changes) do table.insert(uploads, change) end
                local apply = (not served and to_apply) or {}
                served = true
                return { results = { { toApply = apply, more = false } } }
            end,
            exchangeAck = function() return { results = { { acked = 1 } } } end,
        },
        state = { getBook = function() return book end, setUnmatched = function() end },
        digest = "abc123",
        annotations = normalized,
        ann_max_datetime = max_datetime,
        ann_signature = signature,
        apply_mode = "live",
        ui = ui,
    })
    return result, uploads
end

local result, first = exchange(pending_edit)
assertEqual(#first, 0, "nothing local to send before the pull")
assertEqual(result.applied, 1, "the web recolor is applied")
assertEqual(local_item.color, "purple", "the open book shows the new color")
assertEqual(local_item.datetime_updated, server_stamp, "with the server's stamp")

local _, echo = exchange(nil)
assertEqual(#echo, 0, "the applied copy is not sent back to the server")
local _, again = exchange(nil)
assertEqual(#again, 0, "nor on the exchange after")

-- The reader restyles it: KOReader restamps the item with the device clock.
local_item.color = "red"
local_item.datetime_updated = os.date("%Y-%m-%d %H:%M:%S")
local _, restyled = exchange(nil)
assertEqual(#restyled, 1, "a change made after the apply is uploaded")
assertEqual(restyled[1].color, "red", "with the reader's color")

-- A note rewrite moves no timestamp; the note record still catches it.
local_item.note = "rewritten on KOReader"
local _, rewritten = exchange(nil)
assertEqual(#rewritten, 1, "a note rewritten after the apply is uploaded")
assertEqual(rewritten[1].note, "rewritten on KOReader", "with the new text")

print("bookorbit_applied_echo_test: ok")
