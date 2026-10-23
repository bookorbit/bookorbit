--[[--
A full-screen BookOrbit page or sheet, drawn with the dashboard's primitives.

The page builds its content with a build function and routes every tap to the
action of the hit area drawn under the finger, like the board's tiles. A sheet
keeps a lightened copy of the screen it opened over as its backdrop, so the
page underneath is never redrawn while the sheet is up and closing it is one
refresh. On a D-pad device the arrow keys move a focus ring between hit areas
and Press runs the focused one.
]]

local Blitbuffer = require("ffi/blitbuffer")
local Device = require("device")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local InputContainer = require("ui/widget/container/inputcontainer")
local UIManager = require("ui/uimanager")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")

local Screen = Device.screen
local INK = BoardMetrics.INK
local px = BoardMetrics.px

local MenuPage = InputContainer:extend{
    covers_fullscreen = true,
    -- function(page, w, h) returning the page's widget.
    build = nil,
    -- function(page, action), for actions the page does not handle itself.
    on_action = nil,
    -- function(page, action) returning true when the page handled Back
    -- itself (a page with a stack of its own); otherwise Back closes it.
    on_back = nil,
    on_close = nil,
    -- A sheet: keep the screen underneath, lightened, as the backdrop.
    backdrop = false,
    -- Taps outside panel_rect (set by build) close the page.
    dismiss_outside = false,
    panel_rect = nil,
    -- function(page, ges) returning true when it used a swipe (paged text).
    on_swipe = nil,
    -- function(page, delta): the page-turn keys, for pages that turn.
    on_page_key = nil,
    name = "bookorbit_menu_page",
}

local SCRIM = 0.62

function MenuPage:init()
    self.dimen = Geom:new{ x = 0, y = 0, w = Screen:getWidth(), h = Screen:getHeight() }
    if self.backdrop then
        self.backdrop_bb = Screen.bb:copy()
        self.backdrop_bb:lightenRect(0, 0, self.dimen.w, self.dimen.h, SCRIM)
    end
    self.ges_events = {
        TapPage = { GestureRange:new{ ges = "tap", range = self.dimen } },
        SwipePage = { GestureRange:new{ ges = "swipe", range = self.dimen } },
    }
    self.key_events = self.key_events or {}
    if Device:hasKeys() then
        self.key_events.ClosePage = { { Device.input.group.Back } }
    end
    if self.on_page_key and Device:hasKeys() then
        self.key_events.PageKeyFwd = { { Device.input.group.PgFwd } }
        self.key_events.PageKeyBack = { { Device.input.group.PgBack } }
    end
    if Device:hasDPad() then
        self.key_events.FocusUp = { { "Up" } }
        self.key_events.FocusDown = { { "Down" } }
        self.key_events.FocusLeft = { { "Left" } }
        self.key_events.FocusRight = { { "Right" } }
        self.key_events.PressFocus = { { "Press" } }
    end
    self:rebuild()
end

function MenuPage:rebuild()
    local widget, hits = BoardUI.collectHits(function()
        return self.build(self, self.dimen.w, self.dimen.h)
    end)
    if self[1] and self[1].free then self[1]:free() end
    self[1] = widget
    self.hits = hits
    if self.focus_index and self.focus_index > #hits then self.focus_index = #hits end
end

-- Rebuilds and repaints. The sheet's backdrop never changes, so a rebuild only
-- needs the panel's rectangle when the panel kept its size.
function MenuPage:refresh(mode)
    local before = self.panel_rect and self.panel_rect:copy() or nil
    self:rebuild()
    local region = self.dimen
    if before and self.panel_rect and before.h == self.panel_rect.h then region = self.panel_rect end
    UIManager:setDirty(self, function() return mode or "ui", region end)
end

function MenuPage:paintTo(bb, x, y)
    if self.backdrop_bb then
        bb:blitFrom(self.backdrop_bb, 0, 0, 0, 0, self.dimen.w, self.dimen.h)
    else
        bb:paintRect(0, 0, self.dimen.w, self.dimen.h, INK.white)
    end
    self[1]:paintTo(bb, x, y)
    local focused = self.focus_index and self.hits[self.focus_index]
    if focused and focused.dimen then
        local d = focused.dimen
        local ring = math.max(2, px(2.5))
        bb:paintBorder(d.x - ring, d.y - ring, d.w + 2 * ring, d.h + 2 * ring, ring, INK.black, px(8))
    end
end

function MenuPage:onCloseWidget()
    if self.backdrop_bb then
        self.backdrop_bb:free()
        self.backdrop_bb = nil
    end
    if self[1] and self[1].free then self[1]:free() end
end

function MenuPage:close()
    if self.closed then return end
    self.closed = true
    UIManager:close(self, "ui")
    if self.on_close then self.on_close(self) end
end

function MenuPage:onClosePage()
    self:runAction({ kind = "back" })
    return true
end

-- The smallest area under the finger wins, so a button drawn inside a row
-- (Test inside the server field) is reachable whatever order they were built.
function MenuPage:hitAt(pos)
    local best, best_index, best_size
    for index = #self.hits, 1, -1 do
        local area = self.hits[index]
        local d = area.dimen
        if d and pos:intersectWith(d) and (not best_size or d.w * d.h < best_size) then
            best, best_index, best_size = area, index, d.w * d.h
        end
    end
    if best then return best, best_index end
    -- A near miss goes to the closest area within a finger's width, which
    -- gives the small pills and stepper buttons a target the size of a tap.
    local slop, best_dist = px(14), nil
    for index, area in ipairs(self.hits) do
        local d = area.dimen
        if d then
            local dx = math.max(d.x - pos.x, 0, pos.x - (d.x + d.w))
            local dy = math.max(d.y - pos.y, 0, pos.y - (d.y + d.h))
            local dist = math.max(dx, dy)
            if dist <= slop and (not best_dist or dist < best_dist) then
                best, best_index, best_dist = area, index, dist
            end
        end
    end
    return best, best_index
end

function MenuPage:onTapPage(_, ges)
    local area = ges and ges.pos and self:hitAt(ges.pos)
    if area then
        self:runAction(area.action)
    elseif self.dismiss_outside and self.panel_rect and ges and ges.pos and not ges.pos:intersectWith(self.panel_rect) then
        self:close()
    end
    return true
end

-- A sheet closes when pushed back up; pages ignore swipes unless they turn.
function MenuPage:onSwipePage(_, ges)
    if self.on_swipe and ges and self.on_swipe(self, ges) then return true end
    if self.dismiss_outside and ges and ges.direction == "north" then self:close() end
    return true
end

function MenuPage:onPageKeyFwd()
    if self.on_page_key then self.on_page_key(self, 1) end
    return true
end

function MenuPage:onPageKeyBack()
    if self.on_page_key then self.on_page_key(self, -1) end
    return true
end

function MenuPage:runAction(action)
    if not action or action.kind == "noop" then return end
    if action.kind == "back" or action.kind == "close" then
        if action.kind == "back" and self.on_back and self.on_back(self, action) then return end
        self:close()
        return
    end
    if self.on_action then self.on_action(self, action) end
end

-- ------------------------------------------------------------------ focus
local function centre(d)
    return d.x + d.w / 2, d.y + d.h / 2
end

function MenuPage:moveFocus(dx, dy)
    local hits = self.hits or {}
    if #hits == 0 then return true end
    local current = self.focus_index and hits[self.focus_index]
    local old = current and current.dimen and current.dimen:copy()
    local best, best_score
    if not current or not current.dimen then
        best = 1
    else
        local cx, cy = centre(current.dimen)
        for index, area in ipairs(hits) do
            if index ~= self.focus_index and area.dimen then
                local ax, ay = centre(area.dimen)
                local along = (ax - cx) * dx + (ay - cy) * dy
                if along > 1 then
                    local across = math.abs((ax - cx) * dy) + math.abs((ay - cy) * dx)
                    local score = along + across * 2
                    if not best_score or score < best_score then best, best_score = index, score end
                end
            end
        end
    end
    if not best then return true end
    self.focus_index = best
    local ring = math.max(2, px(2.5))
    local function grow(d) return Geom:new{ x = d.x - ring, y = d.y - ring, w = d.w + 2 * ring, h = d.h + 2 * ring } end
    local new = hits[best].dimen
    if old then UIManager:setDirty(self, function() return "fast", grow(old) end) end
    if new then UIManager:setDirty(self, function() return "fast", grow(new) end) end
    return true
end

function MenuPage:onFocusUp() return self:moveFocus(0, -1) end
function MenuPage:onFocusDown() return self:moveFocus(0, 1) end
function MenuPage:onFocusLeft() return self:moveFocus(-1, 0) end
function MenuPage:onFocusRight() return self:moveFocus(1, 0) end

function MenuPage:onPressFocus()
    local area = self.focus_index and self.hits[self.focus_index]
    if area then self:runAction(area.action) end
    return true
end

-- Opens a page over whatever is on screen.
function MenuPage.show(opts)
    local page = MenuPage:new(opts)
    UIManager:show(page, "ui")
    return page
end

MenuPage.Blitbuffer = Blitbuffer

return MenuPage
