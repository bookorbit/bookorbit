-- Rotating the screen (or changing the font or margins) makes KOReader re-lay the
-- book out and then reload the document, which rebuilds the reader and this plugin.
-- The rebuilt plugin took the reload for a fresh open and pulled again. With the
-- other place held as a percentage only, the new layout's page count made the same
-- place look different, and the reader was moved about a page (#2331). A reload of
-- a book whose place was already weighed against BookOrbit's keeps that result and
-- does not pull; a real open, or a book never weighed, still does.

package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = { template = function(text) return text end }
package.loaded["bookorbit_book_sheet"] = { openPrompt = function() end }
package.loaded["bookorbit_toast"] = { show = function() end, error = function() end }
package.loaded["device"] = { model = "Kindle" }
package.loaded["ui/event"] = { new = function(_, name, value) return { name = name, value = value } end }
package.loaded["optmath"] = { roundPercent = function(value) return value end, round = function(value) return value end }
package.loaded["ui/network/manager"] = { willRerunWhenConnected = function() return false end }
package.loaded["ui/uimanager"] = {
    show = function() end,
    nextTick = function(_, fn) fn() end,
    scheduleIn = function(_, _, fn) fn() end,
    unschedule = function() end,
    getElapsedTimeSinceBoot = function() return 10000 end,
}
package.loaded["logger"] = { dbg = function() end, warn = function() end }
package.loaded["ui/time"] = { s = function(value) return value end }
package.loaded["util"] = { partialMD5 = function(file) return "digest:" .. tostring(file) end }
package.loaded["bookorbit_state_manager"] = { repairFileIdentity = function() end }

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local ProgressSync = require("bookorbit_progress_sync")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function assertTrue(value, label)
    if not value then error(label) end
end

-- A plugin instance as KOReader builds it for the open book: a new table each time.
local function newInstance(file)
    local plugin = { SYNC_STRATEGY = { PROMPT = 1, SILENT = 2, DISABLE = 3 } }
    ProgressSync.install(plugin)
    plugin.ui = { document = { file = file } }
    return plugin
end

local BOOK = "/tmp/book.epub"
local OTHER = "/tmp/other.epub"

-- A first open, then a reload of the same book whose place was weighed.
local first = newInstance(BOOK)
assertEqual(first:continuesReloadedBook(false), false, "a real open is not a reload")
first:noteProgressCompared()
local rebuilt = newInstance(BOOK)
assertEqual(rebuilt:continuesReloadedBook(true), true, "a reload of a weighed book carries on")
assertEqual(rebuilt:progressComparedSinceOpen(), true, "the rebuilt plugin inherits the weighed place")

-- The rebuilt plugin weighing again keeps the result for the next reload.
local rebuilt_again = newInstance(BOOK)
assertEqual(rebuilt_again:continuesReloadedBook(true), true, "a second reload still carries on")

-- A real open of the same book afterwards starts over, even before it is weighed.
local reopened = newInstance(BOOK)
assertEqual(reopened:continuesReloadedBook(false), false, "reopening is a fresh session")
assertEqual(reopened:progressComparedSinceOpen(), false, "reopening has not weighed the place")
local reloaded_unweighed = newInstance(BOOK)
assertEqual(reloaded_unweighed:continuesReloadedBook(true), false, "a stale result from an earlier session is dropped")
assertEqual(reloaded_unweighed:progressComparedSinceOpen(), false, "so the reloaded book still pulls")

-- A reload before the place was ever weighed (offline at open, prompt unanswered) pulls.
local fresh = newInstance(OTHER)
assertEqual(fresh:continuesReloadedBook(false), false, "another book opens")
local fresh_reload = newInstance(OTHER)
assertEqual(fresh_reload:continuesReloadedBook(true), false, "a reload that was never weighed pulls")

-- A weighed result for another book never covers this one.
local weighed_other = newInstance(OTHER)
weighed_other:continuesReloadedBook(false)
weighed_other:noteProgressCompared()
local reload_book = newInstance(BOOK)
assertEqual(reload_book:continuesReloadedBook(true), false, "a different book's result does not carry over")

-- The wiring in main.lua: the reader's flag is read before it is cleared, and a
-- reload that carries on skips the open-time pull but still matches the book.
local file = assert(io.open("koreader-plugin/bookorbit.koplugin/main.lua"))
local main = file:read("*a")
file:close()

local reader_ready = assert(main:match(
    "function BookOrbit:onReaderReady%(%)%s*(.-)%s*local function titleFromFile"))
local flag_at = assert(reader_ready:find("self.ui.reloading == true", 1, true), "onReaderReady must read the reader's reloading flag")
local deferred_at = assert(reader_ready:find("UIManager:nextTick", 1, true), "onReaderReady defers the open sync")
assertTrue(flag_at < deferred_at, "the reloading flag must be read before the deferred open sync")
assertTrue(reader_ready:find("skip_progress_pull = self:continuesReloadedBook(reloading)", 1, true),
    "the open match must be told whether this is a weighed reload")

local open_match = assert(main:match(
    "function BookOrbit:requestOpenBookMatch%(source, opts%)%s*(.-)%s*%-%- opts: full_recheck"))
local skip_at = assert(open_match:find("if opts.skip_progress_pull then return end", 1, true), "a reload skips the progress pull")
local pull_at = assert(open_match:find('self:requestProgressPull(true, false, "reader_ready")', 1, true), "the open path still pulls")
local annotation_at = assert(open_match:find("scheduleOpenAnnotationSync", 1, true), "the open path still schedules annotations")
assertTrue(annotation_at < skip_at and skip_at < pull_at, "the skip sits between annotation scheduling and the pull")

print("bookorbit_reload_progress_test.lua: ok")
