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
package.loaded["logger"] = { dbg = function() end }
package.loaded["ui/time"] = { s = function(value) return value end }

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
        file = "/tmp/book.epub",
        info = { has_pages = true },
    },
}
assertEqual(plugin:getDocumentDigest(), "computed:/tmp/book.epub", "digest computes without doc settings")
assertEqual(partial_calls, 1, "partial md5 called once")

local saved_digest
plugin.ui.doc_settings = {
    readSetting = function()
        return nil
    end,
    saveSetting = function(_, _, value)
        saved_digest = value
    end,
}
assertEqual(plugin:getDocumentDigest(), "computed:/tmp/book.epub", "digest computes with empty doc settings")
assertEqual(saved_digest, "computed:/tmp/book.epub", "computed digest is cached when possible")

plugin.ui.doc_settings = {
    readSetting = function()
        return "cached"
    end,
}
assertEqual(plugin:getDocumentDigest(), "cached", "cached digest is returned")

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
