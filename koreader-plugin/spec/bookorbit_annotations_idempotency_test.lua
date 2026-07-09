local sidecar_annotations = {}
local saved_annotations
local marked_external = false
local flushed = false

package.loaded["docsettings"] = {
    open = function()
        return {
            readSetting = function(_, key)
                if key == "annotations" then return sidecar_annotations end
            end,
            saveSetting = function(_, key, value)
                if key == "annotations" then saved_annotations = value end
            end,
            makeTrue = function(_, key)
                if key == "annotations_externally_modified" then marked_external = true end
            end,
            flush = function()
                flushed = true
            end,
        }
    end,
}

package.loaded["ui/event"] = {
    new = function(_, name, payload)
        return { name = name, payload = payload }
    end,
}

local dirty_scope
package.loaded["ui/uimanager"] = {
    setDirty = function(_, scope)
        dirty_scope = scope
    end,
}

package.loaded["logger"] = {
    dbg = function() end,
}

package.loaded["ffi/sha2"] = {
    md5 = function(value)
        return value
    end,
}

package.loaded["util"] = {
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
}

package.loaded["bookorbit_sidecar"] = {
    normalizeAnnotations = function()
        return {}, ""
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitAnnotations = require("bookorbit_annotations")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local handled_event
local ui = {
    rolling = true,
    document = {},
    annotation = {
        annotations = {
            {
                datetime = "2026-07-08 09:10:11",
                datetime_updated = "2026-07-08 09:10:11",
                drawer = "lighten",
                color = "yellow",
                text = "same highlight",
                note = "old note",
                page = "/body/p[1]",
                pos0 = "/body/p[1]",
                pos1 = "/body/p[1].14",
                pageno = 4,
            },
        },
        addItem = function()
            error("redelivery must not insert a duplicate live annotation")
        end,
    },
    handleEvent = function(_, event)
        handled_event = event
    end,
}

local applied, deleted, touched = BookOrbitAnnotations.applyLive(ui, {
    add = {
        {
            serverId = 10,
            version = 5,
            datetime = "2026-07-08 09:10:11",
            datetimeUpdated = "2026-07-08 09:12:00",
            drawer = "lighten",
            color = "blue",
            text = "same highlight",
            note = "new note",
            posFormat = "xpointer",
            pos0 = "/body/p[1]",
            pos1 = "/body/p[1].14",
        },
    },
})

assertEqual(#ui.annotation.annotations, 1, "live redelivery keeps one annotation")
assertEqual(ui.annotation.annotations[1].color, "blue", "live redelivery updates color")
assertEqual(ui.annotation.annotations[1].note, "new note", "live redelivery updates note")
assertEqual(applied[1].status, "applied", "live redelivery is acked")
assertEqual(applied[1].verified, true, "live redelivery is verified")
assertEqual(applied[1].pageno, 4, "live redelivery acks existing page")
assertEqual(#deleted, 0, "live redelivery has no deletes")
assertEqual(touched, 1, "live redelivery touches existing item")
assertEqual(handled_event.name, "AnnotationsModified", "live redelivery sends modified event")
assertEqual(handled_event.payload.index_modified, 1, "live redelivery sends modified index")
assertEqual(dirty_scope, "all", "live redelivery dirties UI")

sidecar_annotations = {
    {
        text = "fallback highlight",
        note = "old sidecar note",
        color = "yellow",
        page = "/body/p[2]",
        pos0 = "/body/p[2]",
        pos1 = "/body/p[2].18",
        pageno = 9,
    },
}
saved_annotations = nil
marked_external = false
flushed = false

applied, deleted, touched = BookOrbitAnnotations.applySidecar("/tmp/book.epub", {
    add = {
        {
            serverId = 11,
            version = 2,
            datetime = "2026-07-08 10:00:00",
            datetimeUpdated = "2026-07-08 10:01:00",
            drawer = "lighten",
            color = "green",
            text = "fallback highlight",
            note = "new sidecar note",
            posFormat = "xpointer",
            pos0 = "/body/p[2]",
            pos1 = "/body/p[2].18",
            pageno = 9,
        },
    },
})

assertEqual(#sidecar_annotations, 1, "sidecar fallback keeps one annotation")
assertEqual(sidecar_annotations[1].datetime, "2026-07-08 10:00:00", "sidecar fallback stabilizes datetime")
assertEqual(sidecar_annotations[1].color, "green", "sidecar fallback updates color")
assertEqual(sidecar_annotations[1].note, "new sidecar note", "sidecar fallback updates note")
assertEqual(applied[1].status, "applied", "sidecar redelivery is acked")
assertEqual(applied[1].verified, false, "sidecar redelivery stays unverified")
assertEqual(#deleted, 0, "sidecar redelivery has no deletes")
assertEqual(touched, 1, "sidecar redelivery touches existing item")
assertEqual(saved_annotations, sidecar_annotations, "sidecar redelivery saves annotations")
assertEqual(marked_external, true, "sidecar redelivery marks external modification")
assertEqual(flushed, true, "sidecar redelivery flushes settings")

print("bookorbit_annotations_idempotency_test.lua: ok")
