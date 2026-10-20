--[[--
BookOrbit settings: one level deep, every value visible where it is changed.

On phones and 6-7" readers the root lists the groups with their current
values and each group is one page. On tablets and in landscape the groups sit
beside the open one, so nothing is drilled into. The shortcut picker is its
own page from Opening BookOrbit.
]]

local Device = require("device")
local Geom = require("ui/geometry")
local IconWidget = require("ui/widget/iconwidget")
local UIManager = require("ui/uimanager")
local _ = require("gettext")
local T = require("ffi/util").template

local BoardMetrics = require("bookorbit_board_metrics")
local BoardStore = require("bookorbit_board_store")
local BoardUI = require("bookorbit_board_ui")
local DownloadRoot = require("bookorbit_download_root")
local MenuPage = require("bookorbit_menu_page")
local MenuUI = require("bookorbit_menu_ui")
local Shortcut = require("bookorbit_shortcut")

local INK = BoardMetrics.INK
local px = BoardMetrics.px
local text, vstack, hstack, flex, space, icon = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.flex, BoardUI.space, BoardUI.icon

local Settings = {}

local STRATEGY = { SILENT = 2, PROMPT = 1, DISABLE = 3 }
local STRATEGY_ORDER = { STRATEGY.SILENT, STRATEGY.PROMPT, STRATEGY.DISABLE }
local PRESETS = { "reader", "stats", "library" }
local TILES = { "outline", "soft", "ink" }

local function scaleLabel(value)
    return string.format("%.2f", value):gsub("0$", "") .. "x"
end

local function indexOf(list, value, fallback)
    for index, v in ipairs(list) do
        if v == value then return index end
    end
    return fallback
end

-- ------------------------------------------------------------- summaries
function Settings.openMode(settings)
    local mode = settings.catalog_auto_open or "off"
    if mode == "home" then return 3 end
    if mode == "filemanager" or mode == "always" then return 2 end
    return 1
end

local function shortcutLabel(page)
    local g = Shortcut.find(Shortcut.current(page.gestures_data))
    return g and g.label() or _("no shortcut")
end

local function openingSummary(page)
    local mode = Settings.openMode(page.plugin.settings)
    local first = mode == 3 and _("BookOrbit is home") or mode == 2 and _("At startup") or _("File browser first")
    return first .. " · " .. shortcutLabel(page)
end

local function syncSummary(settings)
    local auto = settings.auto_sync and _("Automatic") or _("By hand")
    local forward = settings.sync_forward
    local jump = forward == STRATEGY.SILENT and _("jump to newer") or forward == STRATEGY.DISABLE and _("stay put") or _("ask before jumping")
    return auto .. ", " .. jump
end

local PRESET_LABELS = { reader = function() return _("Reader") end, stats = function() return _("Stats") end, library = function() return _("Library") end }

local function homeSummary(settings)
    local state = BoardStore.read(settings)
    return T(_("%1 layout, %2 size"),
        (PRESET_LABELS[state.preset] or PRESET_LABELS.reader)(),
        scaleLabel(BoardMetrics.normalizeUserScale(settings.ui_scale)))
end

local function downloadDir()
    return DownloadRoot.get() or "/"
end

local function folderName(path)
    local name = tostring(path or ""):gsub("/+$", ""):match("([^/]+)$")
    return name or path
end

local CATEGORIES = {
    { id = "opening", icon = "door-open", label = function() return _("Opening BookOrbit") end, sub = function(page) return openingSummary(page) end },
    { id = "sync", icon = "refresh-cw", label = function() return _("Sync") end, sub = function(page) return syncSummary(page.plugin.settings) end },
    { id = "home", icon = "layout-grid", label = function() return _("Home") end, sub = function(page) return homeSummary(page.plugin.settings) end },
    { id = "downloads", icon = "download", label = function() return _("Downloads") end, sub = function() return folderName(downloadDir()) end },
}

local function titleOf(view)
    for _i, cat in ipairs(CATEGORIES) do
        if cat.id == view then return cat.label() end
    end
    if view == "account" then return _("Account") end
    if view == "about" then return _("About & updates") end
    if view == "shortcut" then return _("Shortcut") end
    return _("Settings")
end

-- ----------------------------------------------------------------- lists
local function categoryRows(page, w, compact)
    local rows = {}
    local selected = page.detail
    for _i, cat in ipairs(CATEGORIES) do
        table.insert(rows, MenuUI.row(w, {
            icon = cat.icon, label = cat.label(), bold = compact and selected == cat.id,
            sub = not compact and cat.sub(page) or nil, sub_data = true,
            chevron = not compact, action = { kind = "view", view = cat.id },
        }))
    end
    return rows
end

local function settingsList(page, w, compact)
    local settings = page.plugin.settings
    local iw = MenuUI.rowsIn(w)
    local waiting = page.plugin.getLifecycleOutboxStatus and (page.plugin:getLifecycleOutboxStatus().count or 0) or 0
    local coordinator = page.plugin.getSyncCoordinatorStatus and page.plugin:getSyncCoordinatorStatus() or {}
    waiting = waiting + (coordinator.pending_count or 0)
    local last_sync = type(settings.last_sync) == "table" and settings.last_sync or {}
    local last_error = type(settings.last_error) == "table" and settings.last_error or {}
    local status_summary
    if not page.plugin:isLoggedIn() then
        status_summary = _("Not signed in")
    elseif waiting > 0 then
        status_summary = T(_("%1 changes waiting"), waiting)
    elseif last_error.event ~= "connection_test" and (tonumber(last_error.at) or 0) > (last_sync.event ~= "connection_test" and tonumber(last_sync.at) or 0) then
        status_summary = _("The last sync did not finish")
    elseif not last_sync.at or last_sync.event == "connection_test" then
        status_summary = _("Not synced yet")
    else
        status_summary = _("All synced")
    end
    local update = page.plugin.hasKnownUpdate and page.plugin:hasKnownUpdate() and settings.update_latest_version
    return {
        MenuUI.group(w, categoryRows(page, iw, compact)),
        space(nil, px(16)),
        MenuUI.section(w, _("Account"), MenuUI.group(w, {
            MenuUI.row(iw, { icon = "circle-user-round", label = settings.username or _("Not signed in"), data = true, bold = compact and page.detail == "account",
                sub = not compact and MenuUI.serverHost(settings.server_url) or nil, sub_data = true, chevron = not compact, action = { kind = "view", view = "account" } }),
        })),
        space(nil, px(16)),
        MenuUI.section(w, _("Help"), MenuUI.group(w, {
            MenuUI.row(iw, { icon = "activity", label = _("Sync status"), sub = not compact and status_summary or nil,
                chevron = not compact, action = { kind = "status" } }),
            MenuUI.row(iw, { icon = "circle-help", label = _("About & updates"), bold = compact and page.detail == "about",
                sub = not compact and (update and T(_("Version %1 is ready"), update) or T(_("Version %1"), page.plugin.PLUGIN_VERSION)) or nil,
                trail = not compact and update and MenuUI.chip(_("New"), { ink = true }) or nil,
                chevron = not compact, action = { kind = "view", view = "about" } }),
        })),
    }
end

-- ---------------------------------------------------------------- bodies
local function segRow(w, label, sub, options, selected, action_for)
    return vstack({ w = w, pad = { px(12), 0, px(12), 0 } }, {
        text(label, { s = 16, w = w }),
        sub and text(sub, { s = 13, col = INK.g4, w = w }) or false,
        space(nil, px(8)),
        MenuUI.segmented(w, options, selected, action_for),
    })
end

local function menuBarStrip(page, w)
    local s = px(30)
    local names = { "appbar.filebrowser", "appbar.settings", "appbar.tools", "appbar.search", "bookorbit", "appbar.menu" }
    local cells = {}
    for _i, name in ipairs(names) do
        local glyph
        if name == "bookorbit" then
            glyph = MenuUI.tabIcon(s, page.plugin:menuBarIconPath())
        else
            glyph = IconWidget:new{ icon = name, width = s, height = s }
        end
        local cell = hstack({ w = px(44), h = px(44) }, { flex(0), glyph, flex(0) })
        if name == "bookorbit" then
            cell = BoardUI.overlay(px(44), px(44), {
                { widget = cell },
                { widget = BoardUI.box({ w = px(44), h = px(44), radius = px(10), border = math.max(1, px(1.5)), border_col = INK.black }) },
            })
        end
        table.insert(cells, cell)
    end
    local strip = hstack({ w = w, h = px(52) }, { flex(0), cells[1], flex(0), cells[2], flex(0), cells[3], flex(0), cells[4], flex(0), cells[5], flex(0), cells[6], flex(0) })
    return vstack({ w = w }, { strip, BoardUI.rect(w, math.max(1, px(1.5)), INK.black) })
end

local function openingBody(page, w, embedded)
    local settings = page.plugin.settings
    local iw = MenuUI.rowsIn(w)
    local mode = Settings.openMode(settings)
    local choices = {
        { _("Show the file browser"), _("Open BookOrbit from the menu bar or your shortcut"), "off" },
        { _("Open BookOrbit"), _("Once, when KOReader starts"), "filemanager" },
        { _("Make BookOrbit home"), _("At startup, and whenever you close a book"), "home" },
    }
    local radios = {}
    for index, c in ipairs(choices) do
        table.insert(radios, MenuUI.row(iw, { label = c[1], sub = c[2], radio = index == mode, h = 64, action = { kind = "open-mode", mode = c[3] } }))
    end

    local shortcut_card
    if not Device:isTouchDevice() then
        shortcut_card = MenuUI.card(w, { space(nil, px(12)), text(_("This device has no touchscreen. KOReader's keyboard shortcuts can open BookOrbit: its action is \"BookOrbit: open\"."), { s = 14, w = iw, lines = 3 }), space(nil, px(12)) })
    else
        local g = Shortcut.find(Shortcut.current(page.gestures_data))
        local pill = MenuUI.pill(g and _("Change") or _("Pick one"), { kind = "outline", h = 36, s = 14, pad_x = 14, action = { kind = "view", view = "shortcut" } })
        local illus = MenuUI.gesture(g and g.kind or "none", px(44))
        local mid_w = iw - illus:getSize().w - pill:getSize().w - 2 * px(14)
        shortcut_card = BoardUI.hit(MenuUI.card(w, {
            hstack({ w = iw, h = px(84), gap = px(14) }, {
                illus,
                vstack({ w = mid_w }, {
                    text(g and g.label() or _("No shortcut"), { s = 16, b = true, w = mid_w }),
                    text(g and (g.reader_only and _("Opens BookOrbit from any book") or _("Opens BookOrbit from the file browser and from any book")) or _("Pick a gesture to open BookOrbit"), { s = 13, col = INK.g4, w = mid_w, lines = 2 }),
                }),
                pill,
            }),
        }), { kind = "view", view = "shortcut" })
    end

    local enabled = page.plugin:menuBarIconEnabled()
    local bar_card = MenuUI.card(w, {
        space(nil, px(4)),
        menuBarStrip(page, iw),
        MenuUI.row(iw, { icon = MenuUI.tabIcon(px(24), page.plugin:menuBarIconPath()), label = _("BookOrbit in the menu bar"),
            sub = enabled and _("One tap from KOReader's top menu") or _("Only under Tools in KOReader's menu"), toggle = enabled, action = { kind = "menu-bar" } }),
    })

    return {
        embedded and text(_("Opening BookOrbit"), { s = 18, b = true, w = w }) or false,
        embedded and space(nil, px(12)) or false,
        MenuUI.section(w, _("When KOReader starts"), MenuUI.group(w, radios, { inset = 0 })),
        space(nil, px(16)),
        MenuUI.section(w, _("Shortcut"), shortcut_card),
        space(nil, px(16)),
        MenuUI.section(w, _("KOReader menu bar"), bar_card),
    }
end

local function syncBody(page, w, avail, embedded)
    local settings = page.plugin.settings
    local iw = MenuUI.rowsIn(w)
    local auto = MenuUI.group(w, {
        MenuUI.row(iw, { label = _("Auto-sync"), sub = _("Pull when a book opens, push when it closes and on sleep"), sublines = 2, toggle = settings.auto_sync == true, action = { kind = "toggle-auto" } }),
        MenuUI.row(iw, { label = _("Push while reading"), sub = (settings.pages_before_update or 0) > 0 and _("Every few page turns") or _("Off"), h = 64,
            trail = MenuUI.stepper(settings.pages_before_update or 0, _("pages"), { kind = "push", delta = -1 }, { kind = "push", delta = 1 }) }),
        MenuUI.row(iw, { label = _("Skip when offline"), sub = _("Never wake Wi-Fi just to sync"), toggle = settings.skip_sync_when_offline == true, action = { kind = "flag", key = "skip_sync_when_offline" } }),
        MenuUI.row(iw, { label = _("Two-way highlights & bookmarks"), sub = _("Bring marks made elsewhere to this device"), toggle = settings.annotation_sync == true, action = { kind = "flag", key = "annotation_sync" } }),
    }, { inset = 0 })
    local options = { _("Jump"), _("Ask"), _("Stay") }
    local fwd = indexOf(STRATEGY_ORDER, settings.sync_forward, 2)
    local back = indexOf(STRATEGY_ORDER, settings.sync_backward, 3)
    local function act(key) return function(index) return { kind = "strategy", key = key, value = STRATEGY_ORDER[index] } end end
    local differ
    if embedded and avail < px(640) and iw >= px(360) then
        local half = math.floor((iw - px(24)) / 2)
        differ = MenuUI.card(w, { hstack({ w = iw, gap = px(24), valign = "top" }, {
            segRow(half, _("BookOrbit is ahead"), _("Read further elsewhere"), options, fwd, act("sync_forward")),
            segRow(iw - half - px(24), _("BookOrbit is behind"), _("This device read further"), options, back, act("sync_backward")),
        }) })
    else
        local a = segRow(iw, _("BookOrbit is further ahead"), _("Read further on another device"), options, fwd, act("sync_forward"))
        local b = segRow(iw, _("BookOrbit is further behind"), _("This device read further"), options, back, act("sync_backward"))
        a._no_icon, b._no_icon = true, true
        differ = MenuUI.group(w, { a, b }, { inset = 0 })
    end
    return {
        embedded and text(_("Sync"), { s = 18, b = true, w = w }) or false,
        embedded and space(nil, px(12)) or false,
        MenuUI.section(w, _("Automatic"), auto),
        space(nil, px(16)),
        MenuUI.section(w, _("When positions differ"), differ),
    }
end

local function homeBody(page, w, embedded)
    local settings = page.plugin.settings
    local state = BoardStore.read(settings)
    local iw = MenuUI.rowsIn(w)
    local top = MenuUI.group(w, {
        MenuUI.row(iw, { icon = "layout-grid", label = _("Customize Home"), sub = _("Move, resize, add and remove widgets"), chevron = true, action = { kind = "customize" } }),
        MenuUI.row(iw, { icon = "book-open", label = _("Tap Continue reading"), sub = settings.catalog_dashboard_tap_resumes ~= false and _("Opens the book when it is on this device") or _("Shows the book's details"),
            toggle = settings.catalog_dashboard_tap_resumes ~= false, action = { kind = "flag", key = "catalog_dashboard_tap_resumes", default_on = true } }),
    })
    local preset_labels = { _("Reader"), _("Stats"), _("Library") }
    local tile_labels = { _("Outline"), _("Soft"), _("Ink") }
    local scale_labels = {}
    for index, scale in ipairs(BoardMetrics.UI_SCALES) do
        scale_labels[index] = scaleLabel(scale)
    end
    local a = segRow(iw, _("Starting layout"), _("Replaces your pages with a starter set"), preset_labels, indexOf(PRESETS, state.preset, 1),
        function(index) return { kind = "preset", value = PRESETS[index] } end)
    local b = segRow(iw, _("Tile style"), nil, tile_labels, indexOf(TILES, state.tiles, 1),
        function(index) return { kind = "tiles", value = TILES[index] } end)
    local c = segRow(iw, _("Interface size"), _("Text and controls across BookOrbit"), scale_labels,
        indexOf(BoardMetrics.UI_SCALES, BoardMetrics.normalizeUserScale(settings.ui_scale), 1),
        function(index) return { kind = "ui-scale", value = BoardMetrics.UI_SCALES[index] } end)
    a._no_icon, b._no_icon, c._no_icon = true, true, true
    local look = MenuUI.group(w, { a, b, c }, { inset = 0 })
    local reset = MenuUI.group(w, {
        MenuUI.row(iw, { icon = "rotate-ccw", label = _("Reset Home"), sub = _("Back to the starting layout and outline tiles"), action = { kind = "reset-home" } }),
    })
    return {
        embedded and text(_("Home"), { s = 18, b = true, w = w }) or false,
        embedded and space(nil, px(12)) or false,
        top,
        space(nil, px(16)),
        MenuUI.section(w, _("Look"), look),
        space(nil, px(16)),
        reset,
    }
end

local function downloadsBody(page, w, embedded)
    local iw = MenuUI.rowsIn(w)
    local dir = downloadDir()
    return {
        embedded and text(_("Downloads"), { s = 18, b = true, w = w }) or false,
        embedded and space(nil, px(12)) or false,
        MenuUI.group(w, {
            MenuUI.row(iw, { icon = "download", label = _("Download folder"), sub = dir, sub_data = true, sublines = 2, chevron = true, action = { kind = "download-dir" } }),
        }),
        space(nil, px(12)),
        MenuUI.card(w, { space(nil, px(12)), text(_("Books you download from BookOrbit are saved here. KOReader uses the same folder for its own downloads."), { s = 13, col = INK.g4, w = iw, lines = 3, bg = INK.ge }), space(nil, px(12)) }, { fill = true }),
    }
end

-- Test connection says how its last run went in place.
local function testRow(page)
    local t = page.test
    local o = { icon = "activity", label = _("Test connection"), chevron = true, action = { kind = "test" } }
    if t and t.running then
        o.sub, o.chevron, o.action = _("Testing…"), false, { kind = "noop" }
    elseif t and t.ok then
        o.sub = _("Connection works")
    elseif t and t.err then
        o.sub, o.sub_data = T(_("Connection failed: %1"), t.err), true
    end
    return o
end

local function accountBody(page, w, embedded)
    local settings = page.plugin.settings
    local iw = MenuUI.rowsIn(w)
    return {
        embedded and text(_("Account"), { s = 18, b = true, w = w }) or false,
        embedded and space(nil, px(12)) or false,
        MenuUI.group(w, {
            MenuUI.row(iw, { icon = "globe", label = _("Server"), sub = MenuUI.serverHost(settings.server_url) or _("Not set"), sub_data = true, chevron = true, action = { kind = "server" } }),
            MenuUI.row(iw, { icon = "circle-user-round", label = _("Signed in as"), sub = settings.username or _("Nobody"), sub_data = true }),
            MenuUI.row(iw, testRow(page)),
        }),
        space(nil, px(16)),
        MenuUI.group(w, {
            MenuUI.row(iw, { icon = "log-out", label = _("Sign out"), sub = _("This device stops syncing until you sign in again"), action = { kind = "sign-out" } }),
        }),
    }
end

-- Recheck all books runs in place: progress, then the outcome, on its row.
local function recheckRow(page)
    local s = page.sync
    local o = { icon = "list-checks", label = _("Recheck all books"), sub = _("Matches every book on this device again"), chevron = true, action = { kind = "recheck" } }
    if s and s.running then
        o.sub, o.sub_data, o.chevron, o.action = s.text, true, false, { kind = "noop" }
    elseif s and s.done then
        o.sub = _("Done: every book was checked again")
    elseif s and s.err then
        o.sub, o.sub_data = T(_("Could not recheck: %1"), s.err), true
    end
    return o
end

local function aboutBody(page, w, embedded)
    local plugin = page.plugin
    local iw = MenuUI.rowsIn(w)
    local update = plugin.hasKnownUpdate and plugin:hasKnownUpdate() and plugin.settings.update_latest_version
    local pill = update and MenuUI.pill(T(_("Update to %1"), update), { h = 36, s = 14, pad_x = 14, action = { kind = "update" } })
        or MenuUI.pill(_("Check for update"), { kind = "outline", h = 36, s = 14, pad_x = 14, action = { kind = "check-update" } })
    local mid_w = iw - pill:getSize().w - px(12)
    return {
        embedded and text(_("About & updates"), { s = 18, b = true, w = w }) or false,
        embedded and space(nil, px(12)) or false,
        MenuUI.card(w, {
            hstack({ w = iw, h = px(76), gap = px(12) }, {
                vstack({ w = mid_w }, {
                    text(_("BookOrbit for KOReader"), { s = 16, b = true, w = mid_w }),
                    text(update and T(_("Version %1 is ready, you have %2"), update, plugin.PLUGIN_VERSION) or T(_("Version %1"), plugin.PLUGIN_VERSION), { s = 13, col = INK.g4, w = mid_w }),
                }),
                pill,
            }),
        }),
        space(nil, px(16)),
        MenuUI.group(w, {
            MenuUI.row(iw, recheckRow(page)),
            MenuUI.row(iw, { icon = "file-text", label = _("Technical details"), sub = _("Everything the sync knows, for bug reports"), chevron = true, action = { kind = "diagnostics" } }),
        }),
    }
end

local BODIES = { opening = openingBody, home = homeBody, downloads = downloadsBody, account = accountBody, about = aboutBody }

local function bodyFor(page, view, w, avail, embedded)
    if view == "sync" then return syncBody(page, w, avail, embedded) end
    return (BODIES[view] or openingBody)(page, w, embedded)
end

-- --------------------------------------------------------------- shortcut
local function shortcutBody(page, w)
    local options = Shortcut.available(Device:hasMultitouch())
    local current = Shortcut.current(page.gestures_data)
    local W = BoardMetrics.get().W
    local total = #options + 1
    local cols = W >= 900 and math.min(total, 5) or W >= 700 and 3 or 2
    local gap = px(10)
    local cw = math.floor((w - (cols - 1) * gap) / cols)
    local illus = math.min(px(64), math.floor(cw * 0.42))
    local pad = px(14)
    local name_of = function(binding)
        local ok, name = pcall(function() return require("dispatcher"):menuTextFunc(binding) end)
        return ok and name or _("another action")
    end
    local cards = {}
    local entries = {}
    for _i, g in ipairs(options) do table.insert(entries, { id = g.id, kind = g.kind, label = g.label() }) end
    table.insert(entries, { id = false, kind = "none", label = _("No shortcut") })
    for _i, e in ipairs(entries) do
        local on = (e.id or nil) == current
        local note, warn
        if e.id then
            note, warn = Shortcut.describe(page.gestures_data, e.id, name_of)
        else
            note = _("Menu bar only")
        end
        local iw = cw - 2 * pad
        local note_row = hstack({ w = iw, gap = px(5), valign = "top" }, {
            warn and icon("triangle-alert", px(14), { sw = 2.25 }) or false,
            text(note, { s = 12, col = INK.g4, b = warn, lines = 2, w = iw - (warn and px(19) or 0), data = true }),
        })
        local inner = vstack({ w = iw, pad = { pad, 0, pad, 0 } }, {
            MenuUI.gesture(e.kind, illus),
            space(nil, px(10)),
            text(e.label, { s = 15, b = true, lines = 2, w = iw }),
            space(nil, px(10)),
            note_row,
        })
        local h = inner:getSize().h
        local border = on and math.max(2, px(2.5)) or MenuUI.line()
        local card = BoardUI.overlay(cw, h, {
            { widget = BoardUI.box({ w = cw, h = h, radius = px(12), border = border, border_col = on and INK.black or INK.g8, bg = INK.white }) },
            { widget = inner, x = pad, y = 0 },
            on and { widget = MenuUI.check(), x = cw - px(10) - px(24), y = px(10) } or {},
        })
        table.insert(cards, BoardUI.hit(card, { kind = "shortcut", id = e.id, replaces = warn and note or nil }))
    end
    local rows = {}
    for start = 1, #cards, cols do
        local items = {}
        for index = start, math.min(#cards, start + cols - 1) do table.insert(items, cards[index]) end
        if #rows > 0 then table.insert(rows, space(nil, gap)) end
        table.insert(rows, hstack({ gap = gap, valign = "top" }, items))
    end
    local iw = MenuUI.rowsIn(w)
    return {
        vstack({ w = w }, rows),
        space(nil, px(16)),
        MenuUI.card(w, {
            hstack({ w = iw, gap = px(12), valign = "top" }, {
                vstack({}, { space(nil, px(12)), icon("info", px(20), { sw = 2 }) }),
                vstack({ w = iw - px(32), pad = { px(12), 0, px(12), 0 } }, {
                    text(_("Top-left hold and top-right tap work in books only. Other choices also work in the file browser. Existing actions are named before replacement."), { s = 13, col = INK.g4, lines = 4, w = iw - px(32), bg = INK.ge }),
                }),
            }),
        }, { fill = true }),
    }
end

-- ------------------------------------------------------------------ build
local function build(page, sw, sh)
    local mx = MenuUI.mx()
    local top, bottom = px(6), px(12)
    local w = sw - 2 * mx
    local avail = sh - top - bottom
    local view = page.stack[#page.stack]
    local items
    if view == "shortcut" then
        items = { MenuUI.pageHeader(w, _("Shortcut"), { sub = _("Choose where to open BookOrbit") }), space(nil, px(8)) }
        for _i, item in ipairs(shortcutBody(page, w)) do table.insert(items, item) end
    elseif MenuUI.wide() then
        page.detail = view ~= "root" and view or page.detail or "opening"
        local left_w = math.floor(math.min(px(300), w * 0.36))
        local gutter = px(24)
        local right_w = w - left_w - gutter
        local left = vstack({ w = left_w }, settingsList(page, left_w, true))
        local right = vstack({ w = right_w }, bodyFor(page, page.detail, right_w, avail - px(72), true))
        local split_h = math.max(left:getSize().h, right:getSize().h)
        items = {
            MenuUI.pageHeader(w, _("Settings"), {}),
            space(nil, px(8)),
            hstack({ w = w, h = split_h, valign = "top" }, {
                left,
                space(math.floor(gutter / 2), 1),
                BoardUI.rect(MenuUI.hair(), split_h, INK.gc),
                space(gutter - math.floor(gutter / 2) - MenuUI.hair(), 1),
                right,
            }),
        }
    elseif view == "root" then
        items = { MenuUI.pageHeader(w, _("Settings"), { sub = _("BookOrbit") }), space(nil, px(8)) }
        for _i, item in ipairs(settingsList(page, w, false)) do table.insert(items, item) end
        table.insert(items, flex(px(8)))
        table.insert(items, text(T(_("BookOrbit for KOReader %1"), page.plugin.PLUGIN_VERSION), { s = 13, col = INK.g4, w = w, align = "center" }))
    else
        items = { MenuUI.pageHeader(w, titleOf(view), { sub = _("Settings") }), space(nil, px(8)) }
        for _i, item in ipairs(bodyFor(page, view, w, avail - px(72), false)) do table.insert(items, item) end
    end
    page.panel_rect = Geom:new{ x = 0, y = 0, w = sw, h = sh }
    return vstack({ w = sw, h = sh, pad = { top, mx, bottom, mx } }, items)
end

-- ---------------------------------------------------------------- actions
local function confirm(title, body, ok_text, ok, ok_icon)
    require("bookorbit_dialog_ui").confirm{ title = title, text = body, ok_label = ok_text, ok_icon = ok_icon, on_ok = ok }
end

local function onAction(page, action)
    local plugin, catalog = page.plugin, page.catalog
    local settings = plugin.settings
    local kind = action.kind
    if kind == "view" then
        if MenuUI.wide() and action.view ~= "shortcut" then
            page.detail = action.view
            page.stack = { "root" }
        else
            table.insert(page.stack, action.view)
        end
        page:refresh()
    elseif kind == "status" then
        plugin:openSyncStatus(catalog)
    elseif kind == "open-mode" then
        settings.catalog_auto_open = action.mode
        G_reader_settings:flush()
        page:refresh()
    elseif kind == "menu-bar" then
        plugin:setMenuBarIconEnabled(not plugin:menuBarIconEnabled())
        page:refresh()
    elseif kind == "toggle-auto" then
        plugin:onBookOrbitToggleAutoSync(nil, true, true)
        page:refresh()
    elseif kind == "push" then
        local value = math.max(0, math.min(999, (settings.pages_before_update or 0) + action.delta))
        plugin:setPagesBeforeUpdate(value)
        G_reader_settings:flush()
        page:refresh()
    elseif kind == "flag" then
        local current = settings[action.key]
        if action.default_on then current = current ~= false end
        settings[action.key] = not current
        G_reader_settings:flush()
        page:refresh()
    elseif kind == "strategy" then
        settings[action.key] = action.value
        G_reader_settings:flush()
        page:refresh()
    elseif kind == "customize" then
        page:close()
        plugin:customizeHome(catalog)
    elseif kind == "preset" then
        if BoardStore.read(settings).preset == action.value then return true end
        confirm(_("Start Home from this layout?"), _("Your pages are replaced by this layout's pages."), _("Replace"), function()
            plugin:applyBoardSetting(catalog, function(s) return BoardStore.withPreset(s, action.value) end)
            page:refresh()
        end)
    elseif kind == "tiles" then
        plugin:applyBoardTiles(catalog, action.value)
        page:refresh()
    elseif kind == "ui-scale" then
        if settings.ui_scale == action.value then return true end
        local scale = BoardMetrics.setUserScale(action.value)
        settings.ui_scale = scale
        G_reader_settings:flush()
        if catalog and catalog.interfaceScaleChanged then
            catalog:interfaceScaleChanged()
        elseif catalog and catalog.updateItems then
            catalog:updateItems()
        end
        page:refresh()
    elseif kind == "reset-home" then
        confirm(_("Reset Home?"), _("Your pages and tile style go back to how they started."), _("Reset"), function()
            plugin:applyBoardSetting(catalog, function(s)
                local state = BoardStore.withPreset(s, BoardStore.read(s).preset)
                state.tiles = "outline"
                return state
            end)
            page:refresh()
        end)
    elseif kind == "download-dir" then
        plugin:chooseDownloadFolder(catalog, function() page:refresh() end)
    elseif kind == "server" then
        plugin:setServerAddress(function() page:refresh() end)
    elseif kind == "test" then
        plugin:startPageTest(page, function() page:refresh() end)
    elseif kind == "sign-out" then
        confirm(_("Sign out of BookOrbit?"), _("This device stops syncing until you sign in again. Books already downloaded stay on it."), _("Sign out"), function()
            page:close()
            plugin:signOut(catalog)
        end, "log-out")
    elseif kind == "check-update" then
        plugin:checkForUpdate()
    elseif kind == "update" then
        page:close()
        plugin:applyUpdate(settings.update_latest_version)
    elseif kind == "recheck" then
        plugin:startPageSync(page, function() page:refresh() end, { full_recheck = true })
    elseif kind == "diagnostics" then
        plugin:showDiagnostics()
    elseif kind == "shortcut" then
        local apply = function()
            if not plugin:applyShortcut(action.id or nil) then return end
            page.gestures_data = plugin:gesturesData()
            page:refresh()
        end
        if action.replaces then
            confirm(_("Use this gesture for BookOrbit?"), T(_("%1."), action.replaces), _("Use it"), apply)
        else
            apply()
        end
    end
    return true
end

-- Back steps out of the shortcut picker (or a group on a phone) before it
-- closes Settings.
local function onBack(page)
    if #page.stack > 1 then
        table.remove(page.stack)
        page:refresh()
        return true
    end
    return false
end

-- view: nil for the root, or a group id ("opening", "sync", "home",
-- "downloads", "account", "about", "shortcut").
function Settings.open(plugin, catalog, view)
    -- On wide screens a group opens beside the list rather than on top of it;
    -- only the shortcut picker is a page of its own there.
    local stack = { "root" }
    if view and view ~= "root" and (view == "shortcut" or not MenuUI.wide()) then table.insert(stack, view) end
    local page = MenuPage:new{
        name = "bookorbit_settings",
        build = build,
        on_action = onAction,
        on_back = onBack,
        plugin = plugin,
        catalog = catalog,
        stack = stack,
        detail = view and view ~= "root" and view ~= "shortcut" and view or nil,
        gestures_data = plugin:gesturesData(),
    }
    UIManager:show(page, "ui")
    return page
end

return Settings
