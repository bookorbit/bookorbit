package.loaded["gettext"] = function(text)
    return text
end

package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index)
            return tostring(values[tonumber(index)])
        end))
    end,
}

package.loaded["ui/widget/confirmbox"] = {}
package.loaded["device"] = {}
package.loaded["ui/event"] = { new = function() return {} end }
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["optmath"] = { roundPercent = function(value) return value end }
package.loaded["ui/network/manager"] = {}

local shown_texts = {}
package.loaded["ui/uimanager"] = {
    show = function(_, message)
        table.insert(shown_texts, message.text)
    end,
    scheduleIn = function() end,
    unschedule = function() end,
    getElapsedTimeSinceBoot = function() return 0 end,
}
package.loaded["logger"] = { dbg = function() end, warn = function() end }
package.loaded["ui/time"] = { s = function(value) return value end }

local repairs = {}
package.loaded["bookorbit_state_manager"] = {
    repairFileIdentity = function(file, old_digest, new_digest)
        table.insert(repairs, { file = file, old_digest = old_digest, new_digest = new_digest })
    end,
}

local partial_calls = 0
package.loaded["util"] = {
    partialMD5 = function(file)
        partial_calls = partial_calls + 1
        return "computed:" .. tostring(file)
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local ProgressSync = require("bookorbit_progress_sync")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local plugin = {}
ProgressSync.install(plugin)

plugin.ui = {
    document = {
        file = "/books/book.epub",
        info = { has_pages = true },
    },
}
assertEqual(plugin:getDocumentDigest(), "computed:/books/book.epub", "digest computes without doc settings")
assertEqual(partial_calls, 1, "partial md5 called once")
assertEqual(#repairs, 1, "missing cached identity is recorded")

local saved_digest
plugin.bookorbit_document_digest = nil
plugin.ui.doc_settings = {
    readSetting = function()
        return nil
    end,
    saveSetting = function(_, _, value)
        saved_digest = value
    end,
}
assertEqual(plugin:getDocumentDigest(), "computed:/books/book.epub", "digest computes with empty doc settings")
assertEqual(saved_digest, "computed:/books/book.epub", "computed digest is cached when possible")

plugin.bookorbit_document_digest = nil
plugin.ui.doc_settings = {
    readSetting = function()
        return "cached"
    end,
    saveSetting = function(_, _, value)
        saved_digest = value
    end,
}
local calls_before_repair = partial_calls
assertEqual(plugin:getDocumentDigest(), "computed:/books/book.epub", "stale cached digest is repaired")
assertEqual(saved_digest, "computed:/books/book.epub", "recomputed digest replaces the stale sidecar value")
assertEqual(repairs[#repairs].old_digest, "cached", "repair receives the stale digest")
assertEqual(repairs[#repairs].new_digest, "computed:/books/book.epub", "repair receives the actual digest")
assertEqual(plugin.bookorbit_document_digest.repaired, true, "the open document remembers that statistics recovery is required")
assertEqual(plugin:getDocumentDigest(), "computed:/books/book.epub", "actual digest is cached for the open document")
assertEqual(partial_calls, calls_before_repair + 1, "open document is hashed only once")

plugin.ui = nil
assertEqual(plugin:getDocumentDigest(), nil, "missing UI returns nil")

plugin.isLoggedIn = function()
    return true
end
assertEqual(plugin:reconcileProgressBeforeBookSync("digest", function() end), false, "manual book sync rejects missing UI")
plugin:updateProgress(false, true)
plugin:getProgress(false, true)
assertEqual(shown_texts[1], "No reader book is open.", "manual book sync explains missing reader book")
assertEqual(shown_texts[2], "No reader book is open.", "interactive push explains missing reader book")
assertEqual(shown_texts[3], "No reader book is open.", "interactive pull explains missing reader book")

print("bookorbit_progress_digest_test.lua: ok")
