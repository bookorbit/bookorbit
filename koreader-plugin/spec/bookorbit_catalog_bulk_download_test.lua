local scheduled = {}
local prevent_calls = 0
local allow_calls = 0

package.loaded["ui/bidi"] = {}
package.loaded["datastorage"] = {
    getDataDir = function()
        return "/tmp"
    end,
}
package.loaded["ui/widget/buttondialog"] = {
    new = function(_, opts)
        opts = opts or {}
        function opts:setTitle(title)
            self.title = title
        end
        return opts
    end,
}
package.loaded["ui/widget/infomessage"] = {
    new = function(_, opts)
        return opts or {}
    end,
}
package.loaded["ui/uimanager"] = {
    preventStandby = function()
        prevent_calls = prevent_calls + 1
    end,
    allowStandby = function()
        allow_calls = allow_calls + 1
    end,
    scheduleIn = function(_, _, callback)
        table.insert(scheduled, callback)
    end,
    nextTick = function(_, callback)
        table.insert(scheduled, callback)
    end,
    show = function() end,
    close = function() end,
    forceRePaint = function() end,
}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function()
        return nil
    end,
}
package.loaded["logger"] = {
    dbg = function() end,
    warn = function() end,
}
package.loaded["ffi/util"] = {
    template = function(text)
        return text
    end,
}
package.loaded["gettext"] = function(text)
    return text
end
package.loaded["bookorbit_catalog_util"] = {
    cloneParams = function(value)
        return value or {}
    end,
    formatBytes = function(value)
        return tostring(value)
    end,
    isSupportedFormat = function()
        return true
    end,
    safeFilenameBase = function()
        return "book"
    end,
    shortText = function(value)
        return value
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BulkDownload = require("bookorbit_catalog_bulk_download")
local Catalog = {}
BulkDownload.install(Catalog)

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

Catalog.settings = {}
Catalog:initBulkDownloadState()
Catalog:startBulkSource{
    label = "Empty",
    resolve = function()
        return {}
    end,
}
assertEqual(prevent_calls, 1, "starting a bulk download prevents standby")
assertEqual(allow_calls, 0, "standby remains prevented while preparation is queued")
assertEqual(#scheduled, 1, "preparation is scheduled")

table.remove(scheduled, 1)()
assertEqual(allow_calls, 1, "empty-source abort releases standby")
assertEqual(Catalog.bulk_running, false, "empty-source abort clears running state")

local finish_ctx = {
    standby_prevented = true,
    counts = {
        downloaded = 0,
        linked = 0,
        skipped_on_device = 0,
        skipped_unsupported = 0,
        skipped_existing = 0,
        failed = 0,
    },
    failed_books = {},
    failed_titles = {},
    cancelled = false,
}
prevent_calls = prevent_calls + 1
Catalog.bulk_running = true
Catalog.bulk_ctx = finish_ctx
Catalog.refreshOnDevice = function() end
Catalog.bookMode = function() return false end
Catalog.dashboardMode = function() return false end
Catalog:bulkFinish(finish_ctx)
assertEqual(allow_calls, 2, "normal completion releases standby")
assertEqual(finish_ctx.standby_prevented, false, "completion marks standby lock released")

Catalog:bulkReleaseStandby(finish_ctx)
assertEqual(allow_calls, 2, "standby release is idempotent")

local processed = {}
local cancel_ctx = {
    books = { { id = 1 }, { id = 2 } },
    index = 0,
    total = 2,
    cancel_requested = false,
    cancelled = false,
    counts = {
        downloaded = 0,
        linked = 0,
        skipped_on_device = 0,
        skipped_unsupported = 0,
        skipped_existing = 0,
        path_conflicts = 0,
        failed = 0,
    },
    failed_books = {},
    failed_titles = {},
}
Catalog.bulk_running = true
Catalog.bulk_ctx = cancel_ctx
Catalog.bulkProcessBook = function(_, _, book)
    table.insert(processed, book.id)
end
Catalog:bulkQueueStep(cancel_ctx)
assertEqual(#processed, 1, "first queue step processes one book")
assertEqual(#scheduled, 1, "next item waits for a UI event window")
cancel_ctx.cancel_requested = true
table.remove(scheduled, 1)()
assertEqual(#processed, 1, "cancel prevents the second book from starting")
assertEqual(cancel_ctx.cancelled, true, "cancel marks the run as stopped")
assertEqual(Catalog.bulk_running, false, "cancel finishes the bulk run")

print("bookorbit_catalog_bulk_download_test.lua: ok")
