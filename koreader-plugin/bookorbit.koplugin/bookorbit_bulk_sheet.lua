--[[--
Downloading many books at once, in one sheet: what to download and how, then
the run's progress, then what came of it.

Plan: the books (selected, this page or the whole list), where they go, which
format wins, what happens to files already there, and how read-aloud EPUBs
arrive; one Download button. Progress: which book, how far, the counts so
far, and Stop after this book. Summary: the counts that are not zero, what
needs attention, Retry failed and View on device.
]]

local UIManager = require("ui/uimanager")
local T = require("ffi/util").template
local _ = require("gettext")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local DialogUI = require("bookorbit_dialog_ui")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK
local px = BoardMetrics.px
local text, vstack, hstack, space, flex = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.space, BoardUI.flex

local BulkSheet = {}

local function wOf(widget) return widget:getSize().w end

-- Numbers side by side, each over its label.
local function stats(w, items)
    local n = #items
    local gap = px(8)
    local cw = math.floor((w - gap * (n - 1)) / n)
    local cells = {}
    for _i, it in ipairs(items) do
        table.insert(cells, vstack({ w = cw }, {
            text(tostring(it.value), { s = 20, b = true, w = cw }),
            text(it.label, { s = 12, col = INK.g4, w = cw }),
        }))
    end
    return hstack({ w = w, gap = gap, valign = "top" }, cells)
end

-- ------------------------------------------------------------------ plan
local function planBody(page, w)
    local catalog, plan = page.catalog, page.plan
    local iw = MenuUI.rowsIn(w)
    local items = { DialogUI.titleRow(w, plan.settings_only and _("Download settings") or _("Download books"), plan.sub) }
    local source = plan.scopes and plan.scopes[page.scope] and plan.scopes[page.scope].source or nil
    if plan.scopes and #plan.scopes > 1 then
        local rows = {}
        for index, scope in ipairs(plan.scopes) do
            table.insert(rows, MenuUI.row(iw, { label = scope.label, sub = scope.sub, sub_data = true, radio = index == page.scope, action = { kind = "scope", index = index } }))
        end
        table.insert(items, DialogUI.section(w, _("Books"), MenuUI.group(w, rows)))
    end
    local BookPeek = require("bookorbit_book_peek")
    local folder = catalog:getCurrentDownloadDir()
    local how = {
        MenuUI.row(iw, { icon = "folder-open", label = _("Folder"), sub = BookPeek.folderLabel(folder) or folder, sub_data = true, chevron = true, action = { kind = "folder" } }),
        MenuUI.row(iw, { icon = "file-text", label = _("Format"), sub = catalog:bulkFormatPreset().label, chevron = true, action = { kind = "format" } }),
        MenuUI.row(iw, { icon = "files", label = _("Files already there"), sub = catalog:bulkExistingPolicy().label, chevron = true, action = { kind = "existing" } }),
        MenuUI.row(iw, { icon = "headphones", label = _("Read-aloud EPUBs"), sub = catalog:bulkDeliveryLabel(), chevron = true, action = { kind = "delivery" } }),
    }
    table.insert(items, DialogUI.section(w, _("How"), MenuUI.group(w, how)))
    if plan.settings_only then return items end

    if catalog:bulkExistingPolicy().id == "overwrite" then
        table.insert(items, DialogUI.warn(w, _("Files already there are replaced"), _("Replacing a book can move its place and highlights. Each old file stays until its new copy is complete.")))
    end
    local skips = source and source.known_skips
    if skips and (skips.on_device > 0 or skips.unsupported > 0) then
        local parts = {}
        if skips.on_device > 0 then table.insert(parts, T(_.ngettext("%1 is already on this device", "%1 are already on this device", skips.on_device), skips.on_device)) end
        if skips.unsupported > 0 then table.insert(parts, T(_.ngettext("%1 has no format this reader opens", "%1 have no format this reader opens", skips.unsupported), skips.unsupported)) end
        table.insert(items, DialogUI.note(w, "info", table.concat(parts, "; ") .. ".", { col = INK.g3 }))
    end
    local total = source and source.total or 0
    table.insert(items, MenuUI.pill(catalog:bulkDownloadLabel(total), { icon = "download", w = w, action = { kind = "download" } }))
    return items
end

-- -------------------------------------------------------------- progress
local function progressBody(page, w)
    local ctx = page.ctx
    local counts = ctx.counts or {}
    local total = math.max(ctx.total or 0, ctx.index or 0)
    local title
    if (ctx.index or 0) > 0 then
        title = T(_("Downloading %1 of %2"), ctx.index, total)
    else
        title = ctx.progress_status or _("Getting ready…")
    end
    local items = { DialogUI.titleRow(w, title, ctx.label, { close = false }) }
    local book = ctx.progress_book
    local now = vstack({ w = w }, {
        book and text(book.title or _("Untitled"), { s = 15, b = true, w = w, data = true }) or false,
        (ctx.index or 0) > 0 and ctx.progress_status and text(ctx.progress_status, { s = 13, col = INK.g4, w = w, data = true }) or false,
        space(nil, px(8)),
        BoardUI.bar(w, px(8), total > 0 and math.floor((ctx.index or 0) * 100 / total) or 0, { r = px(4), track = INK.gd }),
    })
    table.insert(items, now)
    table.insert(items, stats(w, {
        { value = counts.downloaded or 0, label = _("Downloaded") },
        { value = (counts.skipped_on_device or 0) + (counts.skipped_present or 0), label = _("Already here") },
        { value = (counts.skipped_existing or 0) + (counts.skipped_unsupported or 0), label = _("Skipped") },
        { value = counts.failed or 0, label = _("Failed") },
    }))
    table.insert(items, MenuUI.pill(ctx.cancel_requested and _("Stopping after this book…") or _("Stop after this book"),
        { kind = "outline", w = w, action = ctx.cancel_requested and { kind = "noop" } or { kind = "stop" } }))
    return items
end

-- --------------------------------------------------------------- summary
local function summaryBody(page, w)
    local s = page.summary
    local iw = MenuUI.rowsIn(w)
    local items = {}
    local tw = w - px(24) - px(12)
    table.insert(items, hstack({ w = w, gap = px(12), valign = "top" }, {
        s.stopped and BoardUI.circle(px(24), { bg = INK.ge }, BoardUI.icon("x", px(15), { sw = 3 })) or MenuUI.check(),
        vstack({ w = tw }, {
            text(s.title, { s = 18, b = true, w = tw }),
            s.sub and text(s.sub, { s = 13, col = INK.g4, w = tw, data = true }) or false,
        }),
    }))
    local rows = {}
    for _i, r in ipairs(s.rows) do
        local v = text(tostring(r.value), { s = 14, b = true })
        local row = hstack({ w = iw, h = px(38) }, { text(r.label, { s = 14, col = INK.g3, w = iw - wOf(v) - px(16) }), flex(px(16)), v })
        row._no_icon = true
        table.insert(rows, row)
    end
    if #rows > 0 then table.insert(items, MenuUI.group(w, rows, { inset = 0 })) end
    for _i, note in ipairs(s.notes) do
        table.insert(items, DialogUI.note(w, "info", note, { col = INK.g3, lines = 3 }))
    end
    if #s.failed_titles > 0 then
        local list = table.concat(s.failed_titles, ", ")
        if s.more_failed > 0 then list = T(_("%1, and %2 more"), list, s.more_failed) end
        table.insert(items, DialogUI.warn(w, _("These did not download"), list))
    end
    if s.can_retry then
        table.insert(items, MenuUI.pill(_("Retry failed"), { icon = "refresh-cw", w = w, action = { kind = "retry" } }))
    end
    table.insert(items, DialogUI.pillRow(w, {
        { label = _("View on device"), kind = "outline", action = { kind = "on-device" } },
        { label = _("Done"), kind = s.can_retry and "outline" or nil, action = { kind = "close" } },
    }))
    return items
end

local function build(page, sw, sh)
    local body = page.state == "progress" and progressBody or page.state == "summary" and summaryBody or planBody
    return DialogUI.sheet(page, sw, sh, function(w) return body(page, w) end, { pop_w = 480 })
end

local function onAction(page, action)
    local catalog = page.catalog
    local kind = action.kind
    local refresh = function() if not page.closed then page:refresh() end end
    if kind == "scope" then
        page.scope = action.index
        refresh()
    elseif kind == "folder" then
        catalog:chooseDownloadDir(refresh)
    elseif kind == "format" then
        catalog:showBulkFormatPresetDialog(refresh)
    elseif kind == "existing" then
        catalog:showBulkExistingPolicyDialog(refresh)
    elseif kind == "delivery" then
        catalog:showDeliveryPreferenceDialog(refresh)
    elseif kind == "download" then
        local scope = page.plan.scopes[page.scope]
        page:close()
        UIManager:tickAfterNext(function() page.plan.on_download(scope.source) end)
    elseif kind == "stop" then
        catalog:bulkRequestStop(page.ctx)
    elseif kind == "retry" then
        page:close()
        UIManager:tickAfterNext(page.summary.on_retry)
    elseif kind == "on-device" then
        page:close()
        UIManager:tickAfterNext(function() catalog:loadOnDevice() end)
    end
    return true
end

-- plan: sub (the list's name), scopes ({ label, sub, source }), scope (the
-- one chosen at first), on_download(source), settings_only.
function BulkSheet.openPlan(catalog, plan)
    return DialogUI.open{
        name = "bookorbit_bulk_sheet",
        build = build,
        on_action = onAction,
        catalog = catalog,
        plan = plan,
        scope = plan.scope or 1,
        state = "plan",
    }
end

-- The run's sheet: it follows ctx (index, total, counts, progress_status,
-- progress_book, cancel_requested) until it is given the summary.
function BulkSheet.openProgress(catalog, ctx)
    local page = DialogUI.open{
        name = "bookorbit_bulk_sheet",
        build = build,
        on_action = onAction,
        catalog = catalog,
        ctx = ctx,
        state = "progress",
        dismiss_outside = false,
    }
    -- Back must not close the only way to stop a run.
    page.on_back = function() return true end
    function page:update()
        if self.closed then return end
        self:refresh()
    end
    -- summary: title, sub, rows ({ label, value }), notes, failed_titles,
    -- more_failed, stopped, can_retry, on_retry.
    function page:finished(summary)
        if self.closed then return end
        self.state, self.summary = "summary", summary
        self.dismiss_outside = true
        self.on_back = nil
        self:refresh()
    end
    return page
end

return BulkSheet
