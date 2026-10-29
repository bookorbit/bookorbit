--[[--
This book: what the BookOrbit icon opens while reading.

It answers what the menu is opened for in a book: is this book synced, and
where does BookOrbit have me? Both positions side by side, Sync now and Open
BookOrbit, or Jump and Stay when BookOrbit is further ahead. BookOrbit's
position is the last one pulled; the sheet refreshes it in the background
when online, so opening it never waits on Wi-Fi.
]]

local ImageWidget = require("ui/widget/imagewidget")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local _ = require("gettext")
local T = require("ffi/util").template

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local BookOrbitStateManager = require("bookorbit_state_manager")
local DeviceNames = require("bookorbit_device_names")
local MenuPage = require("bookorbit_menu_page")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK
local px = BoardMetrics.px
local text, vstack, hstack, space, icon = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.space, BoardUI.icon

local BookSheet = {}

local function pct(value)
    if not value then return nil end
    local n = value * 100
    if n > 0 and n < 0.5 then return "<1%" end
    if n < 100 and n >= 99.5 then return "99%" end
    return tostring(math.floor(n + 0.5)) .. "%"
end

local function annotationCounts(ui)
    local highlights, bookmarks = 0, 0
    local list = ui and ui.annotation and ui.annotation.annotations
    if type(list) == "table" then
        for _i, a in ipairs(list) do
            if a.drawer or a.pos0 then highlights = highlights + 1 else bookmarks = bookmarks + 1 end
        end
    end
    return highlights, bookmarks
end

function BookSheet.data(plugin)
    local ui = plugin.ui
    local doc = ui.document
    local props = ui.doc_props or (doc.getProps and doc:getProps()) or {}
    local digest = plugin:getDocumentDigest()
    local book = digest and BookOrbitStateManager.getBook(digest) or nil
    local local_pct = plugin:getLastPercent()
    local page_no = ui.getCurrentPage and ui:getCurrentPage() or nil
    local pages = doc.getPageCount and doc:getPageCount() or nil
    local remote = plugin.last_remote_progress
    if remote and remote.digest ~= digest then remote = nil end
    local ahead = false
    if remote and remote.percentage and local_pct and remote.percentage - local_pct > 0.005 then
        ahead = plugin:remoteProgressIsNewer({ timestamp = remote.timestamp, percentage = remote.percentage }, local_pct)
    end
    local highlights, bookmarks = annotationCounts(ui)
    local mark = plugin.book_sync_marks and digest and plugin.book_sync_marks[digest]
    return {
        title = props.display_title or props.title or plugin:openBookTitle() or "",
        author = props.authors or "",
        digest = digest,
        matched = book ~= nil,
        incompatible = book ~= nil and book.positionIncompatible == true,
        book_id = book and book.bookId or nil,
        synced = mark and MenuUI.ago(mark) or nil,
        local_pct = local_pct,
        page = page_no,
        pages = pages,
        remote = remote,
        ahead = ahead,
        auto = plugin.settings.auto_sync == true,
        highlights = highlights,
        bookmarks = bookmarks,
        online = NetworkMgr:isConnected(),
    }
end

local function cover(plugin, w, h)
    local doc = plugin.ui and plugin.ui.document
    local ok, bb = pcall(function() return doc and doc.getCoverPageImage and doc:getCoverPageImage() end)
    if not ok or not bb then
        return BoardUI.cover({ title = "" }, w, h, {})
    end
    return ImageWidget:new{ image = bb, width = w, height = h, scale_factor = 0, image_disposable = true }
end

local function head(page, w, chip)
    local d = page.book_data
    local inset = MenuUI.tapInset(24)
    local cw, ch = px(52), px(78)
    local close = MenuUI.iconButton("x", { kind = "close" })
    local tw = w - cw - px(14) - close:getSize().w + inset
    local row = hstack({ w = w + inset, valign = "top", gap = px(14) }, {
        page.cover_widget or cover(page.plugin, cw, ch),
        vstack({ w = tw - px(14) }, {
            text(d.title, { s = 18, b = true, w = tw - px(14), data = true }),
            d.author ~= "" and text(d.author, { s = 13, col = INK.g4, w = tw - px(14), data = true }) or false,
            space(nil, px(6)),
            chip,
        }),
        close,
    })
    return BoardUI.overlay(w, row:getSize().h, { { widget = row } })
end

-- This device's position beside BookOrbit's, the remote one in bold when it
-- is the one asking to be followed.
local function positions(page, w, remote, bold_remote)
    local d = page.book_data
    local pad = px(16)
    local pw = w - 2 * pad
    local function position(glyph, label, value, bold)
        local v = text(value, { s = 14, b = bold, col = bold and INK.black or INK.g4, data = true })
        return hstack({ w = pw, h = px(40), gap = px(12) }, {
            icon(glyph, px(20), { sw = 2 }),
            text(label, { s = 15, w = pw - px(20) - 2 * px(12) - v:getSize().w }),
            v,
        })
    end
    local here = pct(d.local_pct) or "?"
    if d.page and d.pages then here = T(_("%1, page %2 of %3"), here, d.page, d.pages) end
    local there
    if remote and remote.percentage then
        local parts = { pct(remote.percentage) }
        if remote.device and remote.device ~= "" then table.insert(parts, DeviceNames.label(remote.device)) end
        local when = MenuUI.ago(remote.timestamp)
        if when then table.insert(parts, when) end
        there = table.concat(parts, ", ")
    else
        there = page.fetch_done and _("No position yet") or (d.online and _("Checking…") or _("Not checked yet"))
    end
    return MenuUI.card(w, {
        position("tablet", _("This device"), here),
        BoardUI.rect(pw, MenuUI.hair(), INK.gb),
        position("cloud", _("BookOrbit"), there, bold_remote),
    }, { vpad = 4 })
end

-- The progress prompt: BookOrbit holds another place for this book. Both
-- places side by side, buttons that say where they go, and the setting that
-- asked for the prompt one tap away.
local function promptBody(page, w)
    local p = page.prompt
    local d = page.book_data
    local newer = p.newer
    local chip = newer and MenuUI.chip(_("BookOrbit is further ahead"), { icon = "arrow-up-right", ink = true })
        or MenuUI.chip(_("BookOrbit has an earlier place"), { icon = "rotate-ccw" })
    local target = pct(p.remote.percentage) or "?"
    local half = math.floor((w - px(10)) / 2)
    local buttons = hstack({ w = w, gap = px(10) }, {
        MenuUI.pill(newer and T(_("Jump to %1"), target) or T(_("Go back to %1"), target),
            { icon = newer and "arrow-right" or "rotate-ccw", w = half, action = { kind = "prompt-jump" } }),
        MenuUI.pill(newer and _("Stay here") or T(_("Stay at %1"), pct(d.local_pct) or "?"),
            { kind = "outline", w = w - half - px(10), action = { kind = "prompt-stay" } }),
    })
    local items = {
        head(page, w, chip),
        space(nil, px(14)),
        positions(page, w, p.remote, true),
        space(nil, px(14)),
        buttons,
    }
    if p.before_upload then
        table.insert(items, space(nil, px(10)))
        table.insert(items, hstack({ w = w, gap = px(8), valign = "top" }, {
            icon("info", px(16), { sw = 2.25 }),
            text(d.incompatible and _("Reading time syncs either way. Highlights and bookmarks don't sync for this copy.")
                or _("Highlights, bookmarks and reading time sync either way."), { s = 13, col = INK.g3, w = w - px(24), lines = 2 }),
        }))
    end
    table.insert(items, space(nil, px(8)))
    table.insert(items, MenuUI.row(w, {
        icon = "sliders-horizontal",
        label = newer and _("When BookOrbit is ahead") or _("When BookOrbit is behind"),
        value = _("Ask"),
        chevron = true,
        h = 48,
        action = { kind = "prompt-settings" },
    }))
    return items
end

local function body(page, w)
    if page.prompt then return promptBody(page, w) end
    local d = page.book_data
    local chip
    if d.ahead then
        chip = MenuUI.chip(_("BookOrbit is further ahead"), { icon = "arrow-up-right", ink = true })
    elseif d.synced then
        chip = MenuUI.chip(T(_("Synced %1"), d.synced), { icon = "cloud-check" })
    elseif d.matched then
        chip = MenuUI.chip(_("In BookOrbit"), { icon = "cloud-check" })
    else
        chip = MenuUI.chip(_("Not matched yet"), { icon = "cloud-off" })
    end
    local positions_card = positions(page, w, d.remote, d.ahead)

    local half = math.floor((w - px(10)) / 2)
    local buttons
    local running = page.sync and page.sync.running
    if d.ahead and not running then
        buttons = hstack({ w = w, gap = px(10) }, {
            MenuUI.pill(T(_("Jump to %1"), pct(d.remote.percentage)), { icon = "arrow-right", w = half, action = { kind = "jump" } }),
            MenuUI.pill(_("Stay here"), { kind = "outline", w = w - half - px(10), action = { kind = "stay" } }),
        })
    else
        buttons = hstack({ w = w, gap = px(10) }, {
            MenuUI.pill(running and _("Syncing…") or _("Sync now"), { icon = "refresh-cw", w = half, action = running and { kind = "noop" } or { kind = "sync" } }),
            MenuUI.pill(_("Open BookOrbit"), { kind = "outline", w = w - half - px(10), action = { kind = "open" } }),
        })
    end
    -- How the last Sync now went, under the buttons that started it.
    local outcome
    if page.sync and page.sync.err then
        outcome = hstack({ w = w, gap = px(6) }, {
            icon("triangle-alert", px(16), { sw = 2.25 }),
            text(T(_("Could not sync: %1"), page.sync.err), { s = 13, b = true, w = w - px(16) - px(6), data = true }),
        })
    end

    -- A matched copy whose bytes differ from the library file syncs progress as a
    -- percentage and nothing that needs an exact position.
    local copy_note
    if d.incompatible then
        copy_note = hstack({ w = w, gap = px(6), valign = "top" }, {
            icon("info", px(16), { sw = 2 }),
            text(_("This copy is a different file from the one in BookOrbit. Progress syncs as a percentage. Highlights and bookmarks don't sync. Download the book from BookOrbit to sync everything."),
                { s = 13, col = INK.g3, w = w - px(16) - px(6), lines = 4 }),
        })
    end

    local rows = {
        MenuUI.row(w, { icon = "refresh-cw", label = _("Auto-sync"), sub = _("For every book"), toggle = d.auto, action = { kind = "auto" } }),
    }
    if d.book_id then
        table.insert(rows, MenuUI.row(w, { icon = "book-open-text", label = _("Book details in BookOrbit"),
            sub = T(_("%1 highlights, %2 bookmarks"), d.highlights, d.bookmarks), chevron = true, action = { kind = "details" } }))
    end
    -- Jump and Stay replace the Open BookOrbit button, so it moves down here.
    if d.ahead then
        table.insert(rows, MenuUI.row(w, { icon = "house", label = _("Open BookOrbit Home"), chevron = true, action = { kind = "open" } }))
    end
    local list = {}
    for index, r in ipairs(rows) do
        if index > 1 then table.insert(list, MenuUI.divider(w)) end
        table.insert(list, r)
    end

    return {
        head(page, w, chip),
        space(nil, px(14)),
        positions_card,
        space(nil, px(14)),
        buttons,
        outcome and space(nil, px(10)) or false,
        outcome or false,
        copy_note and space(nil, px(10)) or false,
        copy_note or false,
        space(nil, px(14)),
        vstack({ w = w }, list),
    }
end

local function build(page, sw, sh)
    local mx = MenuUI.mx()
    local wide = BoardMetrics.layoutW() >= 700
    local panel_w = wide and math.min(px(520), sw - 2 * mx) or sw
    local pad = wide and px(20) or mx
    local w = panel_w - 2 * pad
    local content = vstack({ w = panel_w, pad = { px(18), pad, px(wide and 18 or 14), pad } }, body(page, w))
    local ph = content:getSize().h
    local x = wide and math.floor((sw - panel_w) / 2) or 0
    local y = wide and (sh - ph - px(24)) or (sh - ph)
    local line = math.max(1, px(1.5))
    local r = px(16)
    local panel
    if wide then
        panel = BoardUI.box({ w = panel_w, h = ph, radius = r, border = line, border_col = INK.black, bg = INK.white }, content)
    else
        -- Rounded at the top with a black rule along it, square at the bottom edge.
        panel = BoardUI.overlay(panel_w, ph, {
            { widget = BoardUI.rect(panel_w, ph, INK.black, r) },
            { widget = BoardUI.rect(panel_w, r, INK.black), y = ph - r },
            { widget = BoardUI.rect(panel_w, ph - line, INK.white, r), y = line },
            { widget = BoardUI.rect(panel_w, r, INK.white), y = ph - r },
            { widget = content },
        })
    end
    page.panel_rect = require("ui/geometry"):new{ x = x, y = y, w = panel_w, h = ph }
    return BoardUI.overlay(sw, sh, { { widget = panel, x = x, y = y } })
end

local function onAction(page, action)
    local plugin = page.plugin
    local kind = action.kind
    if kind == "prompt-jump" then
        page.prompt_resolved = true
        page:close()
        if page.prompt.on_jump then page.prompt.on_jump() end
        return true
    elseif kind == "prompt-stay" then
        page:close()
        return true
    elseif kind == "prompt-settings" then
        page:close()
        UIManager:tickAfterNext(function() plugin:openSettings(nil, "sync") end)
        return true
    end
    if kind == "sync" then
        -- The sheet stays open: the button and the chip follow the sync.
        page.sync = { running = true }
        page:refresh()
        plugin:onBookOrbitSyncBook({
            quiet = true,
            on_done = function(err)
                if page.closed then
                    local Toast = require("bookorbit_toast")
                    if err then Toast.error(T(_("Could not sync: %1"), plugin:syncErrorLabel(err))) else Toast.show(_("Book synced")) end
                    return
                end
                page.sync = err and { err = plugin:syncErrorLabel(err) } or { done = true }
                page.book_data = BookSheet.data(plugin)
                page:refresh()
                if not err then
                    plugin:fetchRemoteProgress(page.book_data.digest, function()
                        if page.closed then return end
                        page.fetch_done = true
                        page.book_data = BookSheet.data(plugin)
                        page:refresh()
                    end, true)
                end
            end,
        })
    elseif kind == "open" then
        page:close()
        plugin:browseCatalog(false)
    elseif kind == "details" then
        page:close()
        plugin:openBookDetails(page.book_data.book_id)
    elseif kind == "auto" then
        plugin:onBookOrbitToggleAutoSync(nil, true, true)
        page.book_data = BookSheet.data(plugin)
        page:refresh()
    elseif kind == "jump" then
        local remote = page.book_data.remote
        page:close()
        plugin:noteProgressCompared(page.book_data.digest)
        plugin:syncToProgress(remote.progress, remote.percentage)
        plugin:recordSyncSuccess("progress_pull", _("Progress pulled"))
    elseif kind == "stay" then
        page:close()
        plugin:noteProgressCompared(page.book_data.digest)
    end
    return true
end

-- Opens the sheet as the progress prompt. prompt: remote ({ percentage,
-- device, timestamp }), newer (BookOrbit is ahead), before_upload (asked by
-- Sync now), on_jump, on_stay. Closing it any way but Jump is Stay.
function BookSheet.openPrompt(plugin, prompt)
    local page = MenuPage:new{
        name = "bookorbit_progress_prompt",
        backdrop = true,
        dismiss_outside = true,
        build = build,
        on_action = onAction,
        plugin = plugin,
        prompt = prompt,
        book_data = BookSheet.data(plugin),
        on_close = function(closed_page)
            if closed_page.prompt_resolved then return end
            closed_page.prompt_resolved = true
            if prompt.on_stay then prompt.on_stay() end
        end,
    }
    UIManager:show(page, "ui")
    return page
end

function BookSheet.open(plugin)
    local page = MenuPage:new{
        name = "bookorbit_book_sheet",
        backdrop = true,
        dismiss_outside = true,
        build = build,
        on_action = onAction,
        plugin = plugin,
        book_data = BookSheet.data(plugin),
        on_close = function(closed_page)
            if plugin.book_sheet == closed_page then plugin.book_sheet = nil end
        end,
    }
    function page:refreshProgress()
        UIManager:nextTick(function()
            if self.closed then return end
            self.book_data = BookSheet.data(plugin)
            self:refresh()
        end)
    end
    plugin.book_sheet = page
    UIManager:show(page, "ui")
    -- BookOrbit's position, refreshed behind the sheet when online.
    local d = page.book_data
    if d.online and d.digest and plugin.fetchRemoteProgress then
        plugin:fetchRemoteProgress(d.digest, function()
            if page.closed then return end
            page.fetch_done = true
            page.book_data = BookSheet.data(plugin)
            page:refresh()
        end)
    end
    return page
end

return BookSheet
