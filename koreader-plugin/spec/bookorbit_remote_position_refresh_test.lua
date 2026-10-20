local function read(path)
    local file = assert(io.open(path))
    local source = file:read("*a")
    file:close()
    return source
end
local source = read("koreader-plugin/bookorbit.koplugin/bookorbit_progress_sync.lua")
local remember = assert(source:match("(function ProgressSync:rememberRemoteProgress.-)\n%-%- Refreshes"))
local fetch = assert(source:match("(function ProgressSync:fetchRemoteProgress.-)\nfunction ProgressSync:schedulePeriodicPush"))
local calls = 0
local response = { percentage = 0.4, progress = "/body/section[2]", device = "other", timestamp = os.time() }
local env = setmetatable({
    ProgressSync = {},
    Math = { roundPercent = function(value) return value end },
    NetworkMgr = { isConnected = function() return true end },
    UIManager = { nextTick = function(_, callback) callback() end },
}, { __index = _G })
local chunk = assert(loadstring(remember .. "\n" .. fetch .. "\nreturn ProgressSync"))
setfenv(chunk, env)
local plugin = chunk()
plugin.isLoggedIn = function() return true end
plugin.runInSyncCoroutine = function(_, callback) callback() end
plugin.newClient = function()
    return { getProgress = function() calls = calls + 1; return response end }
end
plugin:rememberRemoteProgress("digest", { percentage = 0.1, checked_at = os.time() })
local done
plugin:fetchRemoteProgress("digest", function(ok) done = ok end)
assert(calls == 0 and done == true, "ordinary opening reuses a recent position")
plugin:fetchRemoteProgress("digest", function(ok) done = ok end, true)
assert(calls == 1 and plugin.last_remote_progress.percentage == 0.4, "successful sync can bypass the recent cache")
response = {}
plugin:fetchRemoteProgress("digest", function(ok) done = ok end, true)
assert(done == true and plugin.last_remote_progress == nil, "a successful empty response clears the same book's old position")
plugin:rememberRemoteProgress("other-digest", { percentage = 0.2 })
plugin:rememberRemoteProgress("digest", {})
assert(plugin.last_remote_progress.digest == "other-digest", "an empty response cannot clear another book's position")
plugin:rememberRemoteProgress("other-digest", nil)
assert(plugin.last_remote_progress.percentage == 0.2, "failed requests preserve the last known position")

source = read("koreader-plugin/bookorbit.koplugin/bookorbit_book_sheet.lua")
local action = assert(source:match("(local function onAction.-)\nfunction BookSheet.open"))
local refreshes = 0
local page = {
    plugin = plugin,
    book_data = { digest = "digest" },
    refresh = function() refreshes = refreshes + 1 end,
}
plugin.onBookOrbitSyncBook = function(_, opts) opts.on_done() end
plugin.syncErrorLabel = function(_, err) return err end
response = { percentage = 0.6, progress = "/body/section[3]" }
env = setmetatable({
    BookSheet = { data = function(p) return { digest = "digest", remote = p.last_remote_progress } end },
}, { __index = _G })
chunk = assert(loadstring(action .. "\nreturn onAction"))
setfenv(chunk, env)
action = chunk()
action(page, { kind = "sync" })
assert(page.sync.done and page.fetch_done and refreshes == 3)
assert(page.book_data.remote.percentage == 0.6, "the completed sheet displays the freshly fetched server position")
local before = calls
plugin.onBookOrbitSyncBook = function(_, opts) opts.on_done("unavailable") end
action(page, { kind = "sync" })
assert(calls == before and page.sync.err == "unavailable", "a failed sync keeps its error without another request")
local sheet_refreshes = 0
plugin.book_sheet = { refreshProgress = function() sheet_refreshes = sheet_refreshes + 1 end }
plugin:rememberRemoteProgress("digest", { percentage = 0.7 })
plugin:rememberRemoteProgress("digest", {})
assert(sheet_refreshes == 2, "an open sheet follows new and cleared remote positions")

local progress_source = read("koreader-plugin/bookorbit.koplugin/bookorbit_progress_sync.lua")
local jump = assert(progress_source:match("(function ProgressSync:syncToProgress.-)\nfunction ProgressSync:remoteProgressIsNewer"))
env = setmetatable({
    ProgressSync = {},
    Event = { new = function(_, kind, value) return { kind = kind, value = value } end },
    logger = { dbg = function() end },
}, { __index = _G })
chunk = assert(loadstring(jump .. "\nreturn ProgressSync.syncToProgress"))
setfenv(chunk, env)
jump = chunk()
local events = {}
plugin.ui = { document = { info = { has_pages = false } }, handleEvent = function(_, event) events[#events + 1] = event end }
jump(plugin, "/body/section[7]", 0.7)
jump(plugin, nil, 0.2)
assert(sheet_refreshes == 4 and events[1].kind == "GotoXPointer" and events[2].value == 20, "both exact and percentage pulls notify the open sheet")

local open = assert(source:match("(function BookSheet.open.-)\nreturn BookSheet"))
local queued = {}
local live_plugin = {}
env = setmetatable({
    BookSheet = { data = function() return { local_pct = live_plugin.percentage, online = false } end },
    MenuPage = { new = function(_, value) value.refresh = function(self) self.redraws = (self.redraws or 0) + 1 end; return value end },
    UIManager = { show = function() end, nextTick = function(_, callback) queued[#queued + 1] = callback end },
}, { __index = _G })
chunk = assert(loadstring(open .. "\nreturn BookSheet.open"))
setfenv(chunk, env)
open = chunk()
local live_page = open(live_plugin)
live_plugin.percentage = 0.8
live_page:refreshProgress()
queued[1]()
assert(live_page.book_data.local_pct == 0.8 and live_page.redraws == 1, "the next UI tick reads the resolved local position")
live_page:refreshProgress()
live_page.closed = true
live_page.on_close(live_page)
queued[2]()
assert(live_plugin.book_sheet == nil and live_page.redraws == 1, "a closed sheet is released and cannot redraw")
print("bookorbit_remote_position_refresh_test.lua: ok")
