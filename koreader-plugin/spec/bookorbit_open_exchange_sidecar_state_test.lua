-- Opening a re-downloaded book runs the highlight exchange and then the dogear
-- exchange. The highlight exchange fills the new sidecar, so a dogear exchange
-- that judged the sidecar again saw entries, sent no "new" state, and a book
-- with a single dogear would have lost it. Both now get the decision taken
-- before either runs, and the sidecar is marked only after both succeed.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local calls = {}
local marked_with
for _, name in ipairs({ "device", "dispatcher", "ui/widget/infomessage", "ui/network/manager",
    "pluginshare", "ui/trapper", "ui/uimanager", "logger", "libs/libkoreader-lfs", "ffi/sha2",
    "bookorbit_api", "bookorbit_catalog", "bookorbit_lifecycle_outbox", "bookorbit_open_annotation_scheduler",
    "bookorbit_state", "bookorbit_stats_reader", "bookorbit_sync_coordinator", "bookorbit_sync_job_runner",
    "bookorbit_menu_pin" }) do
    package.loaded[name] = {}
end
package.loaded["logger"] = { dbg = function() end, err = function() end }
package.loaded["ffi/util"] = { template = function(text) return text end }
package.loaded["ui/widget/notification"] = { notify = function() end }
package.loaded["gettext"] = function(text) return text end
package.loaded["ui/widget/container/widgetcontainer"] = { extend = function(_, value) return value end }
for _, name in ipairs({ "bookorbit_main_menu", "bookorbit_progress_sync", "bookorbit_updater", "bookorbit_activity" }) do
    package.loaded[name] = { install = function() end }
end
package.loaded["bookorbit_book_sync"] = { isRunning = function() return false end }
package.loaded["bookorbit_sweep"] = { isRunning = function() return false end }
package.loaded["bookorbit_state_manager"] = {
    session = function()
        return { getBook = function() return {} end, flush = function() end }
    end,
}
package.loaded["bookorbit_highlight_summary"] = {
    add = function(summary) return summary end,
    addBookmarks = function(summary) return summary end,
    hasRemoteChanges = function() return false end,
    hasRemoteBookmarkChanges = function() return false end,
}
package.loaded["bookorbit_sidecar"] = {
    isMarked = function(doc_settings) return doc_settings.marked end,
    sidecarState = function(marked, count)
        if marked then return "known" end
        if count == 0 then return "new" end
        return nil
    end,
    markLive = function(doc_settings) marked_with = doc_settings end,
}

local ui = { document = { file = "/books/one.epub" }, annotation = { annotations = {} }, doc_settings = { marked = false } }
local highlights_fail = false
package.loaded["bookorbit_annotations"] = {
    exchangeOpenBook = function(opts)
        table.insert(calls, { kind = "highlights", sidecar_state = opts.sidecar_state })
        -- What applying the re-offered highlights does to the open book.
        table.insert(ui.annotation.annotations, { drawer = "lighten" })
        if highlights_fail then return nil, "network" end
        return { applied = 1, had_errors = false }
    end,
}
package.loaded["bookorbit_bookmarks"] = {
    enabled = function() return true end,
    exchangeOpenBook = function(opts)
        table.insert(calls, { kind = "dogears", sidecar_state = opts.sidecar_state })
        return { applied = 1, had_errors = false }
    end,
    markUnsupported = function() end,
}
G_reader_settings = { flush = function() end }

local Plugin = dofile("koreader-plugin/bookorbit.koplugin/main.lua")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local plugin = setmetatable({ settings = { annotation_sync = true }, ui = ui }, { __index = Plugin })
plugin.isLoggedIn = function() return true end
plugin.getDocumentDigest = function() return "abc123" end
plugin.newClient = function() return {} end
plugin.recordHighlightSync = function() end

plugin:exchangeAnnotationsForOpenBook("annotation_open")
assertEqual(calls[1].kind, "highlights", "highlights exchange first")
assertEqual(calls[1].sidecar_state, "new", "an empty unmarked sidecar is new to the highlight exchange")
assertEqual(calls[2].kind, "dogears", "dogears exchange second")
assertEqual(calls[2].sidecar_state, "new", "the dogear exchange still reports the sidecar as new after highlights landed")
assertEqual(marked_with, ui.doc_settings, "the sidecar is marked once both exchanges went through")

-- A failed exchange leaves the sidecar unmarked, so the next attempt is still new.
calls, marked_with = {}, nil
ui.annotation.annotations = {}
highlights_fail = true
plugin:exchangeAnnotationsForOpenBook("annotation_open")
assertEqual(marked_with, nil, "a failed highlight exchange does not mark the sidecar")

print("bookorbit_open_exchange_sidecar_state_test: ok")
