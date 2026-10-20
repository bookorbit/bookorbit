--[[--
The plugin update, in one sheet: what is new, downloading it, and the
restart that puts it to use, or what went wrong.

States: "available" (Update now / Later), "downloading" (a bar; the sheet
stays up until it finishes), "installed" (Restart now / Later) and "failed"
(Try again / Close).
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

local UpdateSheet = {}

local function v(version)
    if type(version) ~= "string" or version == "" then return _("unknown") end
    return "v" .. version:gsub("^v", "")
end

local function versions(page, w)
    local iw = MenuUI.rowsIn(w)
    local function row(label, value, bold)
        local val = text(value, { s = 14, b = bold, col = bold and INK.black or INK.g3, data = true })
        local r = hstack({ w = iw, h = px(40) }, { text(label, { s = 15 }), flex(px(12)), val })
        r._no_icon = true
        return r
    end
    local rows = {
        row(_("On this device"), v(page.current)),
        row(_("New version"), v(page.latest), true),
    }
    if page.server then table.insert(rows, row(_("BookOrbit server"), v(page.server))) end
    return MenuUI.group(w, rows, { inset = 0 })
end

local function body(page, w)
    local state = page.state
    if state == "available" then
        return {
            DialogUI.titleRow(w, T(_("BookOrbit %1 is ready"), v(page.latest)), _("An update for this plugin")),
            versions(page, w),
            DialogUI.note(w, "info", _("It downloads from your BookOrbit server. KOReader then restarts to use it."), { col = INK.g3 }),
            DialogUI.pillRow(w, {
                { label = _("Later"), kind = "outline", action = { kind = "close" } },
                { label = _("Update now"), icon = "download", action = { kind = "update" } },
            }),
        }
    elseif state == "downloading" then
        local p = page.progress or {}
        local pct = (p.total and p.total > 0) and math.min(100, math.floor((p.received or 0) * 100 / p.total)) or nil
        local sub = pct and T(_("%1%"), pct) or (p.received and T(_("%1 KB"), math.floor(p.received / 1024))) or _("Starting…")
        return {
            DialogUI.titleRow(w, T(_("Updating to %1"), v(page.latest)), nil, { close = false }),
            vstack({ w = w }, {
                BoardUI.spread(w, text(_("Downloading"), { s = 16, b = true }), text(sub, { s = 16, b = true, data = true })),
                space(nil, px(8)),
                BoardUI.bar(w, px(8), pct or 0, { r = px(4), track = INK.gd }),
            }),
            DialogUI.note(w, "hourglass", _("Keep KOReader open until it finishes."), { col = INK.g3 }),
        }
    elseif state == "installed" then
        local tw = w - px(24) - px(12)
        return {
            hstack({ w = w, gap = px(12), valign = "top" }, {
                MenuUI.check(),
                vstack({ w = tw }, {
                    text(T(_("BookOrbit %1 is installed"), v(page.latest)), { s = 18, b = true, w = tw }),
                    text(_("KOReader restarts to use it."), { s = 13, col = INK.g4, w = tw }),
                }),
            }),
            DialogUI.pillRow(w, {
                { label = _("Later"), kind = "outline", action = { kind = "close" } },
                { label = _("Restart now"), icon = "refresh-cw", action = { kind = "restart" } },
            }),
        }
    end
    return {
        DialogUI.titleRow(w, _("The update did not finish"), T(_("BookOrbit %1"), v(page.latest))),
        DialogUI.warn(w, page.error_text or _("Something went wrong."), _("Nothing changed: this device still runs the version it had.")),
        DialogUI.pillRow(w, {
            { label = _("Close"), kind = "outline", action = { kind = "close" } },
            { label = _("Try again"), icon = "refresh-cw", action = { kind = "update" } },
        }),
    }
end

local function build(page, sw, sh)
    return DialogUI.sheet(page, sw, sh, function(w) return body(page, w) end, { pop_w = 460 })
end

-- Moves the sheet to another state and redraws it.
local function setState(page, state, fields)
    if page.closed then return end
    page.state = state
    for k, value in pairs(fields or {}) do page[k] = value end
    page.dismiss_outside = state ~= "downloading"
    page:refresh()
end

local function onAction(page, action)
    local kind = action.kind
    if kind == "update" then
        page.plugin:applyUpdate(page.latest, page)
    elseif kind == "restart" then
        page:close()
        -- Exit code 85 restarts KOReader on Kobo and most e-ink devices;
        -- elsewhere it exits cleanly, to be reopened.
        UIManager:quit(UIManager.RETURN_CODE_REBOOT or 85)
    end
    return true
end

-- o: current, latest, server, state ("available" or "downloading").
function UpdateSheet.open(plugin, o)
    local page = DialogUI.open{
        name = "bookorbit_update_sheet",
        build = build,
        on_action = onAction,
        plugin = plugin,
        current = o.current,
        latest = o.latest,
        server = o.server,
        state = o.state or "available",
        dismiss_outside = (o.state or "available") ~= "downloading",
    }
    function page:downloading() setState(self, "downloading", { progress = nil }) end
    function page:progressed(received, total) setState(self, "downloading", { progress = { received = received, total = total } }) end
    function page:installed() setState(self, "installed") end
    function page:failed(message) setState(self, "failed", { error_text = message }) end
    return page
end

return UpdateSheet
