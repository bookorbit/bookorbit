--[[--
A library sync started from a gesture, in a sheet: what it is doing, how far
it is, Stop syncing, and then what it did.

Syncs started from a BookOrbit page show their progress on that page; this
sheet is for the ones started anywhere else. It stays up while the sync runs,
so a stray tap cannot drop the only way to stop it.
]]

local _ = require("gettext")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local DialogUI = require("bookorbit_dialog_ui")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK
local px = BoardMetrics.px
local text, vstack, hstack, space = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.space

local SyncSheet = {}

local function progressBody(page, w)
    local p = page.progress or {}
    local items = {
        DialogUI.titleRow(w, page.recheck and _("Rechecking books") or _("Syncing your library"), _("BookOrbit"), { close = false }),
    }
    local pct = (p.total and p.total > 0) and math.floor((p.done or 0) * 100 / p.total) or nil
    table.insert(items, vstack({ w = w }, {
        text(p.status or _("Starting…"), { s = 16, b = true, w = w, data = true }),
        space(nil, px(8)),
        BoardUI.bar(w, px(8), pct or 0, { r = px(4), track = INK.gd }),
    }))
    table.insert(items, MenuUI.pill(page.stopping and _("Stopping…") or _("Stop syncing"),
        { kind = "outline", w = w, action = page.stopping and { kind = "noop" } or { kind = "stop" } }))
    return items
end

local function doneBody(page, w)
    local r = page.result
    local items = {}
    local tw = w - px(24) - px(12)
    local glyph = r.error and BoardUI.circle(px(24), { bg = INK.ge }, BoardUI.icon("triangle-alert", px(15), { sw = 2.5 })) or MenuUI.check()
    table.insert(items, hstack({ w = w, gap = px(12), valign = "top" }, {
        glyph,
        vstack({ w = tw }, {
            text(r.title, { s = 18, b = true, w = tw }),
            r.sub and text(r.sub, { s = 13, col = INK.g4, w = tw, lines = 2 }) or false,
        }),
    }))
    if r.stats then
        local n = #r.stats
        local gap = px(8)
        local cw = math.floor((w - gap * (n - 1)) / n)
        local cells = {}
        for _i, st in ipairs(r.stats) do
            table.insert(cells, vstack({ w = cw }, {
                text(tostring(st.value), { s = 20, b = true, w = cw }),
                text(st.label, { s = 12, col = INK.g4, w = cw }),
            }))
        end
        table.insert(items, hstack({ w = w, gap = gap, valign = "top" }, cells))
    end
    for _i, note in ipairs(r.notes or {}) do
        table.insert(items, DialogUI.note(w, "info", note, { col = INK.g3, lines = 3 }))
    end
    table.insert(items, MenuUI.pill(_("Done"), { w = w, action = { kind = "close" } }))
    return items
end

local function build(page, sw, sh)
    local body = page.result and doneBody or progressBody
    return DialogUI.sheet(page, sw, sh, function(w) return body(page, w) end, { pop_w = 440 })
end

-- o: recheck, on_stop.
function SyncSheet.open(o)
    local page = DialogUI.open{
        name = "bookorbit_sync_sheet",
        build = build,
        dismiss_outside = false,
        recheck = o.recheck,
        on_action = function(page, action)
            if action.kind == "stop" then
                page.stopping = true
                page:refresh()
                if o.on_stop then o.on_stop() end
            end
            return true
        end,
    }
    -- Back must not close the only way to stop the sync.
    page.on_back = function() return true end
    function page:progressed(status, done, total)
        if self.closed or self.result then return end
        self.progress = { status = status, done = done, total = total }
        self:refresh()
    end
    -- result: title, sub, stats ({ value, label }), notes, error.
    function page:finished(result)
        if self.closed then return end
        self.result = result
        self.dismiss_outside = true
        self.on_back = nil
        self:refresh()
    end
    return page
end


return SyncSheet
