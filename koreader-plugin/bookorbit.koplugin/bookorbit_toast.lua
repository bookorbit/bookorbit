--[[--
BookOrbit's status pills: one black pill centred above the page's pager.

- Toast.show: a short message. A toast in KOReader's sense: any input closes
  it and still reaches the page underneath.
- Toast.error: a failure, with Retry when there is something to retry.
  Tapping the pill retries; tapping anywhere else only closes it.
- Toast.loading: what is loading while a request runs. It stands in for
  KOReader's TrapWidget, so it is shown before Trapper takes it and any tap,
  hold, swipe or key cancels the request through dismiss_callback.

The pill repaints only its own rectangle, so on e-ink it costs a small
partial refresh instead of a dialog's full one.
]]

local Device = require("device")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local InputContainer = require("ui/widget/container/inputcontainer")
local UIManager = require("ui/uimanager")
local _ = require("gettext")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")

local Screen = Device.screen
local INK = BoardMetrics.INK
local px = BoardMetrics.px

local Toast = {}

local current = nil

-- Above the pager on BookOrbit pages and above KOReader's footer in a book.
local function bottomGap()
    return px(64)
end

local function maxWidth()
    local W = BoardMetrics.layoutW()
    local mx = px(W >= 900 and 28 or W >= 700 and 24 or W >= 560 and 20 or 16)
    return Screen:getWidth() - 2 * mx
end

-- The pill for the first of `variants` (lists of runs) that fits the screen.
local function buildPill(glyph, variants, light)
    local h = px(44)
    local fg = light and INK.black or INK.white
    local max_w = maxWidth()
    local chosen
    for index, parts in ipairs(variants) do
        local runs = {}
        for _i, p in ipairs(parts) do
            table.insert(runs, { t = p.t, b = p.b, col = p.col or fg })
        end
        local line = BoardUI.runs(runs, { s = 15 })
        local w = line:getSize().w + px(14) + (glyph and (px(18) + px(10)) or 0) + px(18)
        if w <= max_w or index == #variants then
            if w > max_w then
                line = BoardUI.runs(runs, { s = 15, w = max_w - (w - line:getSize().w), data = true })
                w = max_w
            end
            chosen = { line = line, w = w }
            break
        end
        if line.free then line:free() end
    end
    local items = { BoardUI.space(px(glyph and 14 or 18), 1) }
    if glyph then
        table.insert(items, BoardUI.icon(glyph, px(18), { sw = 2.5, col = light and "black" or "white" }))
        table.insert(items, BoardUI.space(px(10), 1))
    end
    table.insert(items, chosen.line)
    table.insert(items, BoardUI.flex(0))
    local border = light and math.max(1, px(1.5)) or 0
    return BoardUI.box({ w = chosen.w, h = h, radius = math.floor(h / 2), border = border, border_col = INK.black, bg = light and INK.white or INK.black },
        BoardUI.hstack({ w = chosen.w - 2 * border, h = h - 2 * border }, items))
end

local Pill = InputContainer:extend{
    name = "bookorbit_toast",
    kind = "info",
    glyph = nil,
    variants = nil,
    timeout = nil,
    on_tap = nil,
    dismiss_callback = nil,
}

function Pill:init()
    self[1] = buildPill(self.glyph, self.variants, self.light)
    local size = self[1]:getSize()
    local x = math.floor((Screen:getWidth() - size.w) / 2)
    local y = Screen:getHeight() - (self.bottom or bottomGap()) - size.h
    self.dimen = Geom:new{ x = x, y = y, w = size.w, h = size.h }
    self.toast = self.kind == "info"
    self.modal = self.kind ~= "info"
    local full = Geom:new{ x = 0, y = 0, w = Screen:getWidth(), h = Screen:getHeight() }
    self.ges_events = {
        TapPill = { GestureRange:new{ ges = "tap", range = full } },
        HoldPill = { GestureRange:new{ ges = "hold", range = full } },
        SwipePill = { GestureRange:new{ ges = "swipe", range = full } },
    }
    if Device:hasKeys() then
        self.key_events = { AnyKeyPill = { { Device.input.group.Any } } }
    end
end

function Pill:paintTo(bb, x, y)
    self[1]:paintTo(bb, self.dimen.x, self.dimen.y)
end

function Pill:close()
    if self.closed then return end
    self.closed = true
    if self.timer then UIManager:unschedule(self.timer) end
    if current == self then current = nil end
    UIManager:close(self, "ui", self.dimen)
end

function Pill:onCloseWidget()
    if self.timer then UIManager:unschedule(self.timer) end
    if current == self then current = nil end
    if self[1] and self[1].free then self[1]:free() end
end

-- A toast closes on any input and lets it through; the others take it.
function Pill:handleInput(ges)
    if self.kind == "info" then
        self:close()
        return false
    end
    if self.kind == "loading" then
        if self.dismiss_callback then self.dismiss_callback() end
        self:close()
        return true
    end
    local on_pill = ges and ges.pos and ges.pos:intersectWith(self.dimen)
    self:close()
    if on_pill and self.on_tap then UIManager:nextTick(self.on_tap) end
    return true
end

function Pill:onTapPill(_, ges) return self:handleInput(ges) end
function Pill:onHoldPill(_, ges) return self:handleInput(ges) end
function Pill:onSwipePill(_, ges) return self:handleInput(nil) end
function Pill:onAnyKeyPill() return self:handleInput(nil) end

function Pill:onGesture(ev)
    -- A toast must not stop the page from getting the same gesture.
    if self.toast then
        self:close()
        return false
    end
    return InputContainer.onGesture(self, ev)
end

local function show(pill)
    if current and not current.closed and current.kind ~= "loading" then current:close() end
    current = pill
    UIManager:show(pill, "ui", pill.dimen)
    if pill.timeout then
        pill.timer = function() pill:close() end
        UIManager:scheduleIn(pill.timeout, pill.timer)
    end
    return pill
end

-- A short message. o: icon (default check), timeout (s), bottom (px).
function Toast.show(str, o)
    o = o or {}
    return show(Pill:new{ kind = "info", glyph = o.icon == nil and "check" or o.icon or nil, variants = { { { t = str, b = true } } }, timeout = o.timeout or 2.5, bottom = o.bottom })
end

-- A failure. retry: function to run when the pill is tapped, or nil.
function Toast.error(str, retry, o)
    o = o or {}
    local variants
    if retry then
        variants = {
            { { t = str, b = true }, { t = "   " .. _("Retry"), b = true, col = INK.white } },
            { { t = str, b = true } },
        }
    else
        variants = { { { t = str, b = true } } }
    end
    return show(Pill:new{ kind = retry and "error" or "info", glyph = "triangle-alert", variants = variants, on_tap = retry, timeout = o.timeout or (retry and 10 or 4), bottom = o.bottom })
end

-- What is loading. Returns the pill: hand it to Trapper as its trap widget,
-- then close it when the request returns.
function Toast.loading(str, o)
    o = o or {}
    local hint = INK.gc
    local pill = Pill:new{
        kind = "loading",
        glyph = "hourglass",
        variants = {
            { { t = str, b = true }, { t = "   " .. _("Tap anywhere to stop"), col = hint } },
            { { t = str, b = true }, { t = "   " .. _("Tap to stop"), col = hint } },
            { { t = str, b = true } },
        },
        bottom = o.bottom,
    }
    if o.dismissable == false then
        pill.handleInput = function() return true end
    end
    show(pill)
    UIManager:forceRePaint()
    return pill
end

-- Closes whatever pill is up (a page that opens over it).
function Toast.dismiss()
    if current and not current.closed then current:close() end
end

return Toast
