-- Two highlights made in the same second (different passages) arrive together on a fresh copy of the book, as
-- after a re-download. Each must become its own item: the second must not match the first by datetime and be
-- moved onto it, which left the device with one highlight while both were acked.

local sidecar_annotations = {}
local saved_annotations

package.loaded["docsettings"] = {
    open = function()
        return {
            readSetting = function(_, key)
                if key == "annotations" then return sidecar_annotations end
            end,
            saveSetting = function(_, key, value)
                if key == "annotations" then saved_annotations = value end
            end,
            makeTrue = function() end,
            flush = function() end,
        }
    end,
}

package.loaded["ui/event"] = {
    new = function(_, name, payload)
        return { name = name, payload = payload }
    end,
}

package.loaded["ui/uimanager"] = { setDirty = function() end }
package.loaded["logger"] = { dbg = function() end }
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["util"] = {
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
}
package.loaded["bookorbit_sidecar"] = {
    normalizeAnnotations = function() return {}, "" end,
    serializePos = function(pos) return pos end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitAnnotations = require("bookorbit_annotations")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local SECOND = "2026-10-18 11:37:53"
local TEXTS = {
    ["/body/DocFragment[38]/body/div/p[18]/text().0"] = "Then she turns away from us",
    ["/body/DocFragment[38]/body/div/p[22]/text().8"] = "She is pulling mushrooms out",
}

local function entry(server_id, pos0, pos1)
    return {
        serverId = server_id,
        version = 1,
        datetime = SECOND,
        drawer = "lighten",
        color = "yellow",
        text = TEXTS[pos0],
        posFormat = "xpointer",
        pos0 = pos0,
        pos1 = pos1,
    }
end

local function batch()
    return {
        add = {
            entry(2020, "/body/DocFragment[38]/body/div/p[18]/text().0", "/body/DocFragment[38]/body/div/p[18]/text().27"),
            entry(2021, "/body/DocFragment[38]/body/div/p[22]/text().8", "/body/DocFragment[38]/body/div/p[22]/text().36"),
        },
    }
end

local ui = {
    rolling = true,
    document = {
        isXPointerInDocument = function() return true end,
        getTextFromXPointers = function(_, pos0) return TEXTS[pos0] end,
    },
    annotation = {
        annotations = {},
        addItem = function(self, item)
            table.insert(self.annotations, item)
            return #self.annotations
        end,
    },
    handleEvent = function() end,
}

local applied = BookOrbitAnnotations.applyLive(ui, batch())
assertEqual(#ui.annotation.annotations, 2, "open book: both same-second highlights are kept")
assertEqual(ui.annotation.annotations[1].text, TEXTS["/body/DocFragment[38]/body/div/p[18]/text().0"], "open book: the first keeps its text")
assertEqual(ui.annotation.annotations[2].pos0, "/body/DocFragment[38]/body/div/p[22]/text().8", "open book: the second has its own range")
assertEqual(applied[1].pos0, "/body/DocFragment[38]/body/div/p[18]/text().0", "open book: the first is acked at its own range")
assertEqual(applied[2].pos0, "/body/DocFragment[38]/body/div/p[22]/text().8", "open book: the second is acked at its own range")

-- The same batch applied again finds each highlight once, by its range, and adds nothing.
applied = BookOrbitAnnotations.applyLive(ui, batch())
assertEqual(#ui.annotation.annotations, 2, "open book: a repeated batch adds nothing")
assertEqual(applied[2].pos0, "/body/DocFragment[38]/body/div/p[22]/text().8", "open book: a repeated batch acks each at its own range")

applied = BookOrbitAnnotations.applySidecar("/books/yesteryear.epub", batch())
assertEqual(#saved_annotations, 2, "closed book: both same-second highlights are written")
assertEqual(saved_annotations[1].text, TEXTS["/body/DocFragment[38]/body/div/p[18]/text().0"], "closed book: the first keeps its text")
assertEqual(saved_annotations[2].pos0, "/body/DocFragment[38]/body/div/p[22]/text().8", "closed book: the second has its own range")

-- A delete for one row in the batch never removes the highlight another row of the batch was just applied to.
sidecar_annotations = {}
local mixed = batch()
mixed.add[2] = nil
mixed.delete = { { serverId = 2021, datetime = SECOND } }
BookOrbitAnnotations.applySidecar("/books/yesteryear.epub", mixed)
assertEqual(#saved_annotations, 1, "closed book: a same-second delete leaves the highlight added in the batch")

print("bookorbit_same_second_apply_test.lua: ok")
