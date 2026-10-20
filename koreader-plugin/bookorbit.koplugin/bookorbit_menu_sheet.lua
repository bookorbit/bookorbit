--[[--
The BookOrbit menu: the sheet the menu button and a swipe down from the top
edge open on every BookOrbit page.

Who and where you are, the three things done most (sync, customize or go
Home, leave), every place in the library with its count, then settings, sync
status and help. A full-width sheet from the top on phones and 6-7" readers;
a popover under the button it came from on tablets and in landscape. Built
from data the catalog already holds, so opening it never waits on the network.
]]

local NetworkMgr = require("ui/network/manager")
local datetime = require("datetime")
local _ = require("gettext")
local T = require("ffi/util").template

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local MenuPage = require("bookorbit_menu_page")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK
local px = BoardMetrics.px
local text, vstack, hstack, flex, space, icon = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.flex, BoardUI.space, BoardUI.icon

local MenuSheet = {}

local NAV = {
    { link = "library", icon = "book-copy", label = function() return _("Library") end, count = "library" },
    { link = "authors", icon = "feather", label = function() return _("Authors") end, count = "authors" },
    { link = "series", icon = "layers-2", label = function() return _("Series") end, count = "series" },
    { link = "collections", icon = "folder-open", label = function() return _("Collections") end, count = "collections" },
    { link = "scopes", icon = "aperture", label = function() return _("SmartScopes") end, count = "scopes" },
    { link = "device", icon = "tablet", label = function() return _("On device") end, count = "device" },
}

-- Which Go to entry the catalog is showing, so the sheet can mark it.
local function currentPlace(catalog)
    local context = catalog and catalog.current_context or {}
    if context.kind == "section" then
        if context.section == "authors" then return "authors" end
        if context.section == "series" then return "series" end
        if context.section == "shelves" then return "shelves" end
        if context.section == "collections" then return "collections" end
        if context.section == "smart-scopes" then return "scopes" end
    elseif context.kind == "books" then
        if context.on_device_filter then return "device" end
        local params = context.params or {}
        local scoped = params.authorId or params.author or params.seriesId or params.series or params.collectionId or params.scopeId or params.smartScopeId or params.libraryId or params.q
        if not scoped then return "library" end
    end
    return nil
end

function MenuSheet.data(plugin, catalog)
    local settings = plugin.settings or {}
    local body = catalog and catalog.dashboardCache and catalog:dashboardCache() or {}
    local counts = type(body.browseCounts) == "table" and body.browseCounts or {}
    local outbox = plugin.getLifecycleOutboxStatus and plugin:getLifecycleOutboxStatus() or { count = 0 }
    local coordinator = plugin.getSyncCoordinatorStatus and plugin:getSyncCoordinatorStatus() or { pending_count = 0 }
    local last_sync = type(settings.last_sync) == "table" and settings.last_sync or {}
    local last_error = type(settings.last_error) == "table" and settings.last_error or {}
    local now = os.time()
    local context = catalog and catalog.current_context or {}
    local d = {
        name = body.displayName or body.username or settings.username or "",
        host = MenuUI.serverHost(settings.server_url) or "",
        online = NetworkMgr:isConnected(),
        synced = last_sync.event ~= "connection_test" and MenuUI.ago(last_sync.at, now) or nil,
        signed_in = plugin:isLoggedIn(),
        sync_error = last_error.event ~= "connection_test" and (tonumber(last_error.at) or 0) > (last_sync.event ~= "connection_test" and tonumber(last_sync.at) or 0),
        waiting = (outbox.count or 0) + (coordinator.pending_count or 0),
        clock = datetime.secondsToHour(now, G_reader_settings:isTrue("twelve_hour_clock")),
        counts = {
            library = tonumber(body.totalBooks or body.bookCount),
            authors = tonumber(counts.authors),
            series = tonumber(counts.series),
            collections = tonumber(counts.collections),
            scopes = tonumber(counts.smartScopes),
            device = catalog and catalog.onDeviceCount and catalog:onDeviceCount() or nil,
        },
        update = plugin.hasKnownUpdate and plugin:hasKnownUpdate() and settings.update_latest_version or nil,
        version = plugin.PLUGIN_VERSION,
        on_home = catalog == nil or (catalog.dashboardMode and catalog:dashboardMode()),
        list = (context.kind == "books" or (context.kind == "section" and (context.section == "authors" or context.section == "series"))) and (context.title or _("This list")) or nil,
        place = currentPlace(catalog),
        book = plugin.ui and plugin.ui.document and plugin:openBookTitle() or nil,
    }
    return d
end

local function tile(w, h, glyph, label, sub, action, data)
    local pad = px(14)
    local iw = w - 2 * pad
    local inner = vstack({ w = iw, h = h }, {
        flex(0),
        icon(glyph, px(24), { sw = 2 }),
        space(nil, px(6)),
        text(label, { s = 15, b = true, w = iw }),
        text(sub, { s = 12, col = INK.g4, w = iw, data = data }),
        flex(0),
    })
    return BoardUI.hit(MenuUI.card(w, { inner }, { pad = 14 }), action)
end

local function navGrid(w, d, ncols)
    local pad = px(16)
    local iw = w - 2 * pad
    local gap = px(24)
    local cw = math.floor((iw - (ncols - 1) * gap) / ncols)
    local rh = px(50)
    local rows = {}
    for start = 1, #NAV, ncols do
        local cells = {}
        for index = start, math.min(#NAV, start + ncols - 1) do
            local entry = NAV[index]
            local here = d.place == entry.link or (d.place == "shelves" and (entry.link == "collections" or entry.link == "scopes"))
            local count = d.counts[entry.count]
            local right = here and MenuUI.chip(_("Here"), { h = 22 })
                or text(count and tostring(count) or "", { s = 14, col = INK.g4 })
            local cell = hstack({ w = cw, h = rh, gap = px(12) }, {
                icon(entry.icon, px(20), { sw = here and 2.5 or 2 }),
                text(entry.label(), { s = 15, b = here, w = cw - px(20) - 2 * px(12) - right:getSize().w }),
                right,
            })
            table.insert(cells, BoardUI.hit(cell, { kind = "link", link = entry.link }))
        end
        if #rows > 0 then table.insert(rows, BoardUI.rect(iw, MenuUI.hair(), INK.gb)) end
        table.insert(rows, hstack({ w = iw, h = rh, gap = gap }, cells))
    end
    local card = MenuUI.card(w, rows)
    local layers = { { widget = card } }
    local h = card:getSize().h
    for k = 1, ncols - 1 do
        table.insert(layers, { widget = BoardUI.rect(MenuUI.hair(), h - 2 * px(10), INK.gb), x = pad + k * cw + math.floor((k - 0.5) * gap), y = px(10) })
    end
    return BoardUI.overlay(w, h, layers)
end

-- The sheet's content at width w. o.popover drops the status cluster and
-- search (the page behind keeps them in view); o.cols lays places out wider.
function MenuSheet.body(d, w, o)
    o = o or {}
    local inset = MenuUI.tapInset(24)
    local sub
    if not d.online then
        sub = { { t = _("Offline"), b = true, col = INK.black }, { t = _(", changes saved here") } }
    elseif d.synced then
        sub = { { t = d.host .. " · " }, { t = T(_("Synced %1"), d.synced) } }
    else
        sub = { { t = d.host } }
    end
    local right = {}
    if not o.popover then
        table.insert(right, BoardUI.statusCluster(d))
        table.insert(right, space(px(6), 1))
        table.insert(right, MenuUI.iconButton("search", { kind = "search" }))
    end
    table.insert(right, MenuUI.iconButton("x", { kind = "close" }))
    local right_group = hstack({}, right)
    local title_w = w - right_group:getSize().w + inset
    local header = hstack({ w = w + inset, h = px(64) }, {
        vstack({ w = title_w }, {
            text(d.name, { s = 22, b = true, w = title_w, data = true }),
            BoardUI.runs(sub, { s = 13, col = INK.g4, w = title_w, data = true }),
        }),
        right_group,
    })

    local gap = px(10)
    local tw = math.floor((w - 2 * gap) / 3)
    local th = px(o.popover and 80 or 84)
    -- The sync tile shows the run it started, in place: progress, then the
    -- outcome. Tapping it while it runs offers to stop.
    local first
    local sync = d.sync
    if sync and sync.running then
        first = tile(tw, th, "refresh-cw", _("Syncing…"), sync.text or _("Starting"), { kind = "sync-stop" }, true)
    elseif sync and sync.err then
        first = tile(tw, th, "triangle-alert", _("Sync failed"), sync.err, { kind = "sync" }, true)
    elseif sync and sync.done then
        first = tile(tw, th, "check", _("Synced"), _("Just now"), { kind = "sync" })
    elseif not d.online then
        first = tile(tw, th, "wifi", _("Connect"), d.waiting > 0 and T(_("%1 waiting"), d.waiting) or _("Wi-Fi is off"), { kind = "connect" })
    else
        first = tile(tw, th, "refresh-cw", _("Sync now"), d.waiting > 0 and T(_("%1 waiting"), d.waiting) or _("Nothing waiting"), { kind = "sync" })
    end
    local second = d.on_home and tile(tw, th, "layout-grid", _("Customize"), _("Edit Home"), { kind = "customize" })
        or tile(tw, th, "house", _("Home"), _("Your board"), { kind = "home" })
    local last_w = w - 2 * tw - 2 * gap
    local third = d.book and tile(last_w, th, "book-open", _("Back to book"), d.book, { kind = "exit" }, true)
        or tile(last_w, th, "folder-open", _("Files"), _("Close BookOrbit"), { kind = "exit" })
    local tiles = hstack({ w = w, gap = gap }, { first, second, third })

    local iw = MenuUI.rowsIn(w)
    local rows = {}
    if d.list then
        table.insert(rows, MenuUI.row(iw, { icon = "list-filter", label = _("Sort, filter and view"), sub = d.list, sub_data = true, chevron = true, action = { kind = "list-options" } }))
    end
    table.insert(rows, MenuUI.row(iw, { icon = "sliders-horizontal", label = _("Settings"), sub = _("Opening, sync, Home, downloads"), chevron = true, action = { kind = "settings" } }))
    local status_summary
    if not d.signed_in then
        status_summary = _("Not signed in")
    elseif d.waiting > 0 then
        status_summary = not d.online and T(_("%1 changes waiting to send"), d.waiting) or T(_("%1 waiting"), d.waiting)
    elseif d.sync_error then
        status_summary = _("The last sync did not finish")
    else
        status_summary = d.synced and _("All synced") or _("Not synced yet")
    end
    table.insert(rows, MenuUI.row(iw, { icon = "activity", label = _("Sync status"),
        sub = status_summary,
        chevron = true, action = { kind = "status" } }))
    table.insert(rows, MenuUI.row(iw, { icon = "circle-help", label = _("Help & about"),
        sub = d.update and T(_("Version %1 is ready"), d.update) or T(_("Version %1"), d.version),
        trail = d.update and MenuUI.chip(_("New"), { ink = true }) or nil,
        chevron = true, action = { kind = "about" } }))

    local banner
    if d.update then
        local bw = MenuUI.rowsIn(w)
        local pill = MenuUI.pill(_("Update"), { h = 36, s = 14, pad_x = 16, action = { kind = "update" } })
        local mid_w = bw - px(22) - pill:getSize().w - 2 * px(12)
        banner = MenuUI.card(w, {
            hstack({ w = bw, gap = px(12) }, {
                icon("download", px(22), { sw = 2 }),
                vstack({ w = mid_w }, {
                    text(T(_("BookOrbit %1 is ready"), d.update), { s = 15, b = true, w = mid_w }),
                    text(_("Takes a few seconds, then KOReader restarts"), { s = 13, col = INK.g4, w = mid_w, lines = 2, bg = INK.ge }),
                }),
                pill,
            }),
        }, { fill = true, vpad = 12 })
    end

    return {
        BoardUI.overlay(w, px(64), { { widget = header, x = 0, y = 0 } }),
        space(nil, px(8)),
        banner or false,
        banner and space(nil, px(12)) or false,
        tiles,
        space(nil, px(16)),
        MenuUI.section(w, _("Go to"), navGrid(w, d, o.cols or 2)),
        space(nil, px(16)),
        MenuUI.group(w, rows),
    }
end

-- Builds the whole screen: the sheet or popover over the lightened backdrop.
local function build(page, sw, sh)
    local d = page.sheet_data
    local mx = MenuUI.mx()
    if MenuUI.wide() then
        local pw = math.min(px(MenuUI.landscape() and 620 or 460), sw - 2 * mx)
        local pad = px(18)
        local content = vstack({ w = pw - 2 * MenuUI.line(), pad = { px(4), pad - MenuUI.line(), pad, pad - MenuUI.line() } },
            MenuSheet.body(d, pw - 2 * pad, { popover = true, cols = MenuUI.landscape() and 3 or 2 }))
        local ph = content:getSize().h + 2 * MenuUI.line()
        local panel = BoardUI.box({ w = pw, h = ph, radius = px(16), border = math.max(1, px(1.5)), border_col = INK.black, bg = INK.white }, content)
        -- Under the button it came from: top right on Home and on the lists.
        local x = sw - mx - pw
        local y = px(52)
        page.panel_rect = require("ui/geometry"):new{ x = x, y = y, w = pw, h = ph }
        return BoardUI.overlay(sw, sh, { { widget = panel, x = x, y = y } })
    end
    local w = sw - 2 * mx
    local content = vstack({ w = sw, pad = { px(6), mx, px(18), mx } }, MenuSheet.body(d, w))
    local ph = content:getSize().h
    local line = math.max(1, px(1.5))
    local r = px(16)
    -- Square at the top edge, rounded at the bottom with a black rule along it.
    local layers = {
        { widget = BoardUI.rect(sw, ph, INK.black, r) },
        { widget = BoardUI.rect(sw, r, INK.black) },
        { widget = BoardUI.rect(sw, ph - line, INK.white, r) },
        { widget = BoardUI.rect(sw, r, INK.white) },
        { widget = content },
    }
    page.panel_rect = require("ui/geometry"):new{ x = 0, y = 0, w = sw, h = ph }
    return BoardUI.overlay(sw, sh, layers)
end

-- opts.on_action(page, action) runs everything the sheet does not do itself.
function MenuSheet.open(plugin, catalog, on_action)
    local page = MenuPage:new{
        name = "bookorbit_menu_sheet",
        backdrop = true,
        dismiss_outside = true,
        build = build,
        on_action = on_action,
        sheet_data = MenuSheet.data(plugin, catalog),
    }
    require("ui/uimanager"):show(page, "ui")
    return page
end

return MenuSheet
