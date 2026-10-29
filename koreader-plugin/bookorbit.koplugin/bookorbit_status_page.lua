--[[--
Sync status: the diagnostics list rewritten as an answer.

A verdict first (all synced, waiting, offline, or the last failure), three
numbers, what happened recently, then the fixes. The old key-value list stays
one tap down as Technical details.
]]

local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local _ = require("gettext")
local T = require("ffi/util").template

local Activity = require("bookorbit_activity")
local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local MenuPage = require("bookorbit_menu_page")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK
local px = BoardMetrics.px
local text, vstack, hstack, flex, space, icon = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.flex, BoardUI.space, BoardUI.icon

local Status = {}

function Status.data(plugin)
    local settings = plugin.settings
    local summary = require("bookorbit_sweep").syncStatus() or {}
    local outbox = plugin.getLifecycleOutboxStatus and plugin:getLifecycleOutboxStatus() or { count = 0 }
    local coordinator = plugin.getSyncCoordinatorStatus and plugin:getSyncCoordinatorStatus() or { pending_count = 0 }
    local last_sync = type(settings.last_sync) == "table" and settings.last_sync or {}
    local last_error = type(settings.last_error) == "table" and settings.last_error or nil
    local d = {
        online = NetworkMgr:isConnected(),
        matched = summary.matched or 0,
        unmatched = summary.unmatched or 0,
        waiting = (outbox.count or 0) + (coordinator.pending_count or 0),
        synced = last_sync.event ~= "connection_test" and MenuUI.ago(last_sync.at) or nil,
        last_message = last_sync.event ~= "connection_test" and last_sync.message or nil,
        user = settings.username or "",
        host = MenuUI.serverHost(settings.server_url) or "",
        activity = Activity.list(settings),
    }
    -- A failure newer than the last success is the verdict until it clears.
    if last_error and last_error.event ~= "connection_test"
        and (tonumber(last_error.at) or 0) > (last_sync.event ~= "connection_test" and tonumber(last_sync.at) or 0) then
        d.error = { message = last_error.message, when = MenuUI.ago(last_error.at) }
    end
    return d
end

local function hero(d, w, sync)
    local pad = px(18)
    local iw = w - 2 * pad
    local glyph, title, sub, inverted
    if sync and sync.running then
        glyph, inverted = "refresh-cw", true
        title = sync.recheck and _("Rechecking books…") or _("Syncing…")
        sub = sync.text
    elseif not d.online then
        glyph, inverted = "wifi-off", true
        title = d.waiting > 0 and T(_("Offline: %1 changes waiting"), d.waiting) or _("Offline")
        sub = _("Kept on this device and sent when Wi-Fi is back")
    elseif d.error then
        glyph, inverted = "triangle-alert", true
        title = _("The last sync did not finish")
        sub = d.error.when and T(_("%1, %2"), d.error.message or _("unknown error"), d.error.when) or d.error.message
    elseif d.waiting > 0 then
        glyph, inverted = "clock", true
        title = T(_("%1 changes waiting to send"), d.waiting)
        sub = _("They go out with the next sync")
    elseif not d.synced then
        glyph, inverted = "refresh-cw", true
        title = _("Not synced yet")
        sub = _("Sync now to match the books on this device with your library")
    else
        glyph = "check"
        title = _("Everything is synced")
        sub = d.last_message and T(_("Last sync %1, %2"), d.synced, d.last_message) or T(_("Last sync %1"), d.synced)
    end
    local disc = inverted and BoardUI.circle(px(52), { border = math.max(2, px(2)), bg = INK.white }, icon(glyph, px(26), { sw = 2.75 }))
        or BoardUI.circle(px(52), { bg = INK.black }, icon(glyph, px(26), { col = "white", sw = 2.75 }))
    local tw = iw - px(52) - px(16)
    return MenuUI.card(w, {
        hstack({ w = iw, gap = px(16) }, {
            disc,
            vstack({ w = tw }, {
                text(title, { s = 20, b = true, w = tw }),
                text(sub or "", { s = 13, col = INK.g4, w = tw, lines = 2, data = true }),
            }),
        }),
    }, { pad = 18, vpad = 18, strong = true })
end

local function statTile(w, value, label, action, label_s)
    local pad = px(14)
    local iw = w - 2 * pad
    local head = action and hstack({ gap = px(6) }, { text(tostring(value), { s = 26, b = true }), icon("chevron-right", px(16), { sw = 2.5 }) })
        or text(tostring(value), { s = 26, b = true })
    local card = MenuUI.card(w, { vstack({ w = iw }, { head, space(nil, px(2)), text(label, { s = label_s or 13, col = INK.g4, lines = 2, w = iw }) }) }, { pad = 14, vpad = 12 })
    return action and BoardUI.hit(card, action) or card
end

local function stats(d, w)
    local gap = px(10)
    local tw = math.floor((w - 2 * gap) / 3)
    local tiles = {
        { tw, d.matched, _("books matched") },
        { w - 2 * tw - 2 * gap, d.unmatched, _("not in BookOrbit"), d.unmatched > 0 and { kind = "unmatched" } or nil },
        { tw, d.waiting, _("waiting to send") },
    }
    -- One caption size for the row, stepped down until every caption fits
    -- its two lines.
    local linesNeeded = require("bookorbit_text_pages").linesNeeded
    local label_s = 13
    while label_s > 11 do
        local fits = true
        for _i, t in ipairs(tiles) do
            if linesNeeded(t[3], { s = label_s }, t[1] - 2 * px(14)) > 2 then fits = false end
        end
        if fits then break end
        label_s = label_s - 1
    end
    local cells = {}
    for _i, t in ipairs(tiles) do table.insert(cells, statTile(t[1], t[2], t[3], t[4], label_s)) end
    return hstack({ w = w, gap = gap, valign = "top" }, cells)
end

-- As many recent events as fit in max_h.
local function activityList(d, w, max_h)
    local iw = MenuUI.rowsIn(w)
    local tw = px(78)
    local rows = {}
    local used = 0
    for _i, a in ipairs(d.activity) do
        local cw = iw - tw - px(10) - (a.warn and px(30) or 0)
        local r = hstack({ w = iw, gap = px(10) }, {
            text(MenuUI.ago(a.at) or "", { s = 13, col = INK.g4, w = tw }),
            vstack({ w = cw, pad = { px(8), 0, px(8), 0 } }, {
                text(a.text, { s = 15, w = cw, lines = 2, data = true }),
                a.sub and text(a.sub, { s = 13, col = INK.g4, w = cw, lines = 2, data = true }) or false,
            }),
            a.warn and icon("triangle-alert", px(20), { sw = 2 }) or false,
        })
        local h = math.max(px(60), r:getSize().h)
        r = hstack({ w = iw, h = h }, { r, flex(0) })
        r._no_icon = true
        if max_h and used + h + MenuUI.hair() > max_h and #rows > 0 then break end
        used = used + h + MenuUI.hair()
        table.insert(rows, r)
    end
    if #rows == 0 then
        local empty = hstack({ w = iw, h = px(60) }, { text(_("Sync events will show here."), { s = 14, col = INK.g4, w = iw }) })
        empty._no_icon = true
        table.insert(rows, empty)
    end
    return MenuUI.group(w, rows, { inset = 0 })
end

-- Side by side, or one above the other in a narrow column. While a sync
-- runs, the first one stops it; each says how its last run went.
local function actions(d, w, stacked, sync, test)
    local half = stacked and w or math.floor((w - px(10)) / 2)
    local first
    if sync and sync.running then
        first = MenuUI.pill(_("Stop syncing"), { kind = "outline", action = { kind = "sync-stop" }, w = half })
    elseif sync and sync.done and not sync.recheck then
        first = MenuUI.pill(_("Synced"), { icon = "check", action = { kind = "sync" }, w = half })
    else
        first = MenuUI.pill(d.online and _("Sync now") or _("Connect and sync"), { icon = d.online and "refresh-cw" or "wifi", action = { kind = d.online and "sync" or "connect" }, w = half })
    end
    local second_w = stacked and w or (w - half - px(10))
    local second
    if test and test.running then
        second = MenuUI.pill(_("Testing…"), { kind = "outline", action = { kind = "noop" }, w = second_w })
    elseif test and test.ok then
        second = MenuUI.pill(_("Connection works"), { kind = "outline", icon = "check", action = { kind = "test" }, w = second_w })
    elseif test and test.err then
        second = MenuUI.pill(_("Connection failed"), { kind = "outline", icon = "triangle-alert", action = { kind = "test" }, w = second_w })
    else
        second = MenuUI.pill(_("Test connection"), { kind = "outline", action = { kind = "test" }, w = second_w })
    end
    if stacked then return vstack({ w = w }, { first, space(nil, px(10)), second }) end
    return hstack({ w = w, gap = px(10) }, { first, second })
end

local function fixes(w, compact, sync)
    local iw = MenuUI.rowsIn(w)
    local recheck_sub = not compact and _("Matches every book on this device again") or nil
    if sync and sync.recheck then
        if sync.running then recheck_sub = sync.text
        elseif sync.done then recheck_sub = _("Done: every book was checked again")
        elseif sync.err then recheck_sub = T(_("Could not recheck: %1"), sync.err) end
    end
    return MenuUI.group(w, {
        MenuUI.row(iw, { icon = "list-checks", label = _("Recheck all books"), sub = recheck_sub, sub_data = sync and sync.running,
            chevron = not (sync and sync.running), action = (sync and sync.running) and { kind = "noop" } or { kind = "recheck" } }),
        MenuUI.row(iw, { icon = "file-text", label = _("Technical details"), sub = not compact and _("Everything the sync knows, for bug reports") or nil, chevron = true, action = { kind = "diagnostics" } }),
    })
end

local function build(page, sw, sh)
    local d = page.status_data
    local mx = MenuUI.mx()
    local top, bottom = px(6), px(12)
    local w = sw - 2 * mx
    local subtitle = not page.plugin:isLoggedIn() and _("Not signed in")
        or d.host == "" and d.user or T(_("%1 on %2"), d.user, d.host)
    local header = MenuUI.pageHeader(w, _("Sync status"), { sub = subtitle, sub_data = true })
    if MenuUI.landscape() then
        local gutter = px(24)
        local lw = math.floor((w - gutter) / 2)
        local rw = w - lw - gutter
        local h_hero = hero(d, w, page.sync)
        local room = sh - top - bottom - header:getSize().h - px(8) - h_hero:getSize().h - px(12)
        -- The first arrangement whose left column fits a short screen with
        -- nothing cut: the buttons stacked, then side by side, then with the
        -- fixes moved under the recent activity, stacked and side by side.
        local function left(stacked, with_fixes)
            return vstack({ w = lw }, {
                stats(d, lw), space(nil, px(10)), actions(d, lw, stacked, page.sync, page.test),
                with_fixes and space(nil, px(10)) or false, with_fixes and fixes(lw, true, page.sync) or false,
            })
        end
        local choice
        for _i, v in ipairs({ { true, true }, { false, true }, { true, false }, { false, false } }) do
            local clean, probe = BoardUI.fits(function() return BoardUI.collectHits(function() return left(v[1], v[2]) end) end)
            local h = probe and probe.getSize and probe:getSize().h or math.huge
            if probe and probe.free then probe:free() end
            if clean and h <= room then choice = v; break end
        end
        choice = choice or { true, false }
        local right_fixes = not choice[2] and fixes(rw, true, page.sync) or nil
        local list_room = room - BoardMetrics.lh1(13) - px(8) - (right_fixes and (right_fixes:getSize().h + px(10)) or 0)
        local right = vstack({ w = rw }, {
            MenuUI.label(rw, _("Recent activity")), space(nil, px(8)), activityList(d, rw, list_room),
            right_fixes and space(nil, px(10)) or false, right_fixes or false,
        })
        return vstack({ w = sw, h = sh, pad = { top, mx, bottom, mx } }, {
            header, space(nil, px(8)), h_hero, space(nil, px(12)),
            hstack({ w = w, gap = gutter, valign = "top" }, { left(choice[1], choice[2]), right }),
        })
    end
    local fixed = { header, space(nil, px(8)), hero(d, w, page.sync), space(nil, px(10)), stats(d, w), space(nil, px(16)) }
    local tail = { space(nil, px(16)), actions(d, w, false, page.sync, page.test), space(nil, px(16)), fixes(w, sh / BoardMetrics.get().dp < 1000, page.sync) }
    local used = 0
    for _i, item in ipairs(fixed) do used = used + item:getSize().h end
    for _i, item in ipairs(tail) do used = used + item:getSize().h end
    local avail = sh - top - bottom - used - BoardMetrics.lh1(13) - px(8)
    local items = fixed
    table.insert(items, MenuUI.section(w, _("Recent activity"), activityList(d, w, avail)))
    for _i, item in ipairs(tail) do table.insert(items, item) end
    return vstack({ w = sw, h = sh, pad = { top, mx, bottom, mx } }, items)
end

local function onAction(page, action)
    local plugin = page.plugin
    local kind = action.kind
    -- The page stays open for all three: its verdict follows the run.
    local refresh = function(reload)
        if reload then page.status_data = Status.data(plugin) end
        page:refresh()
    end
    if kind == "sync" or kind == "connect" then
        local start = function() plugin:startPageSync(page, refresh) end
        if kind == "connect" then NetworkMgr:runWhenConnected(start) else start() end
    elseif kind == "sync-stop" then
        plugin:confirmStopSync()
    elseif kind == "test" then
        plugin:startPageTest(page, refresh)
    elseif kind == "recheck" then
        plugin:startPageSync(page, refresh, { full_recheck = true })
    elseif kind == "diagnostics" then
        plugin:showDiagnostics()
    elseif kind == "unmatched" then
        require("bookorbit_dialog_ui").notice{
            title = _("Books not in BookOrbit"),
            text = _("Some books on this device are not in your BookOrbit library: files copied by hand, or edited since they were downloaded. Recheck all books to try matching them again."),
        }
    end
    return true
end

function Status.open(plugin)
    local page = MenuPage:new{
        name = "bookorbit_sync_status",
        build = build,
        on_action = onAction,
        plugin = plugin,
        status_data = Status.data(plugin),
    }
    UIManager:show(page, "ui")
    return page
end

return Status
