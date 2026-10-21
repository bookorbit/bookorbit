package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
local summaries = {}
local cached = {}
package.loaded["docsettings"] = {
    open = function(_, file)
        return {
            readSetting = function() return summaries[file] end,
            saveSetting = function(_, _, value) summaries[file] = value end,
            flush = function() end,
        }
    end,
}
package.loaded["ui/widget/booklist"] = {
    setBookInfoCacheProperty = function(file, property, value) cached[file .. property] = value end,
}
package.loaded["libs/libkoreader-lfs"] = {}
local Sidecar = require("bookorbit_sidecar")
local book = {}
local complete = Sidecar.stateFromServerResult({
    status = "complete", statusSet = true, statusUpdatedAt = "2026-06-05T08:00:00.000Z",
    ratingSet = false, reviewNoteSet = false,
})
assert(complete.status_known and complete.status == "complete")
summaries.book = { status = "reading", modified = "2026-06-04" }
assert(Sidecar.applyServerStateSidecar("book", complete))
assert(summaries.book.status == "complete" and cached.bookstatus == "complete")
Sidecar.rememberServerState(book, complete)
local summary = Sidecar.normalizeSummary(summaries.book)
assert(Sidecar.buildStatePayload("hash", book, summary, false) == nil,
    "a pulled completion is not uploaded again")
summary.status = "reading"
local payload = Sidecar.buildStatePayload("hash", book, summary, false)
assert(payload.status == "reading", "same-day status changes are not hidden by the date watermark")
local live = {
    document = { file = "book" },
    doc_settings = {
        readSetting = function() return summaries.book end,
        saveSetting = function(_, _, value) summaries.book = value end,
    },
}
local reread = Sidecar.stateFromServerResult({status="reading",statusSet=true,statusUpdatedAt="2026-06-06T08:00:00.000Z"})
assert(Sidecar.applyServerStateLive(live, reread))
assert(summaries.book.status == "reading" and cached.bookstatus == "reading")
local legacy = Sidecar.stateFromServerResult({ratingSet = true,rating = 4})
assert(not legacy.status_known and legacy.rating == 4, "an older response leaves status alone")
Sidecar.applyServerStateLive(live, legacy)
assert(summaries.book.status == "reading")
assert(Sidecar.stateFromServerResult({statusSet=true,status="unknown"}) == nil)
print("bookorbit_status_exchange_test: PASS")

package.path = "koreader-plugin/spec/?.lua;" .. package.path
local SweepHarness = require("helpers/sweep_harness")
for _, target in ipairs({ "missing", "open.epub", "closed.epub" }) do
    local live_calls, sidecar_calls = 0, 0
    local harness = SweepHarness.install{
        library_version = "v1",
        state = {
            books = { hash = { bookId = 1, fileId = 2, file = "closed.epub", sidecarMtime = 1 } },
            global = { libraryVersion = "v1" },
        },
        sidecar = {
            sidecarMtime = function() return 1 end,
            stateFromServerResult = function() return { status_known = true, status = "complete" } end,
            applyServerStateLive = function(ui)
                assert(ui.document.file == "open.epub")
                live_calls = live_calls + 1
            end,
            applyServerStateSidecar = function(file)
                assert(file == "closed.epub")
                sidecar_calls = sidecar_calls + 1
                return false
            end,
        },
    }
    package.loaded["apps/reader/readerui"].instance = {
        document = { file = "open.epub" },
        saveSettings = function() end,
    }
    local original_new = package.loaded["bookorbit_api"].new
    package.loaded["bookorbit_api"].new = function(...)
        local client = original_new(...)
        client.uploadBookStates = function(_, batch)
            assert(#batch == 1)
            harness.state:getBook("hash").file = target ~= "missing" and target or nil
            return { results = { { hash = "hash" } }, unmatched = {} }
        end
        return client
    end
    local finished = false
    assert(require("bookorbit_sweep").run{
        api = {}, annotation_sync = false, quiet = true,
        on_finish = function(err) assert(not err); finished = true end,
    })
    harness.scheduler:drain()
    assert(finished)
    assert(live_calls == (target == "open.epub" and 1 or 0),
        "a missing or unrelated sweep path must not update the open book")
    assert(sidecar_calls == (target == "closed.epub" and 1 or 0))
end
print("bookorbit_status_exchange_sweep_test: PASS")
