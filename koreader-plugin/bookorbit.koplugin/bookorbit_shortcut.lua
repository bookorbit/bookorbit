--[[--
One-tap gesture shortcut to open BookOrbit.

Binds a KOReader gesture to the "BookOrbit: open" Dispatcher action in its
supported contexts, through the running Gestures plugin so its
own settings file is the one written. A gesture that already does something
is named before it is replaced, using KOReader's titles for the action.
]]

local _ = require("gettext")
local T = require("ffi/util").template

local Shortcut = {}

Shortcut.ACTION = "bookorbit_open_dashboard"

local SECTIONS = { "gesture_fm", "gesture_reader" }

-- Unused in a fresh KOReader except the last, which is Bookmark in books.
Shortcut.GESTURES = {
    { id = "hold_top_left_corner", kind = "hold-tl", reader_only = true, label = function() return _("In books: hold the top-left corner") end },
    { id = "tap_right_bottom_corner", kind = "tap-br", label = function() return _("Tap the bottom-right corner") end },
    { id = "two_finger_tap_top_right_corner", kind = "two-tr", label = function() return _("Two-finger tap, top right") end, multitouch = true },
    { id = "tap_top_right_corner", kind = "tap-tr", reader_only = true, label = function() return _("In books: tap the top-right corner") end },
}

function Shortcut.find(id)
    for _i, g in ipairs(Shortcut.GESTURES) do
        if g.id == id then return g end
    end
end

-- The offered gestures this device can make.
function Shortcut.available(has_multitouch)
    local out = {}
    for _i, g in ipairs(Shortcut.GESTURES) do
        if not g.multitouch or has_multitouch then table.insert(out, g) end
    end
    return out
end

local function bindsUs(binding)
    return type(binding) == "table" and binding[Shortcut.ACTION] ~= nil
end

local function isEmpty(binding)
    return type(binding) ~= "table" or next(binding) == nil
end

-- The offered gesture that opens BookOrbit, if any.
function Shortcut.current(data)
    if type(data) ~= "table" then return nil end
    for _i, g in ipairs(Shortcut.GESTURES) do
        for _j, section in ipairs(SECTIONS) do
            if (not g.reader_only or section == "gesture_reader")
                and bindsUs(data[section] and data[section][g.id]) then return g.id end
        end
    end
    return nil
end

-- What picking `id` would replace, as one short line ("Free", "In books,
-- replaces Bookmark"), and whether anything is replaced at all. name_of
-- turns a binding into KOReader's title for it.
function Shortcut.describe(data, id, name_of)
    if type(data) ~= "table" then return _("Free"), false end
    local gesture = Shortcut.find(id)
    local names = {}
    for _j, section in ipairs(SECTIONS) do
        local binding = data[section] and data[section][id]
        if (not gesture or not gesture.reader_only or section == "gesture_reader")
            and not isEmpty(binding) and not bindsUs(binding) then
            names[section] = name_of and name_of(binding) or _("another action")
        end
    end
    local fm, reader = names.gesture_fm, names.gesture_reader
    if fm and reader then
        if fm == reader then return T(_("Replaces %1"), fm), true end
        return T(_("Replaces %1 and %2"), fm, reader), true
    elseif reader then
        return T(_("In books, replaces %1"), reader), true
    elseif fm then
        return T(_("In the file browser, replaces %1"), fm), true
    end
    if Shortcut.current(data) == id then return _("Opens BookOrbit"), false end
    return _("Free"), false
end

-- Binds `id` (or nothing, for nil) in its supported contexts. Any
-- other offered gesture that opened BookOrbit stops doing so.
function Shortcut.bind(data, id)
    if type(data) ~= "table" then return false end
    for _j, section in ipairs(SECTIONS) do
        data[section] = data[section] or {}
        for _i, g in ipairs(Shortcut.GESTURES) do
            local binding = data[section][g.id]
            if bindsUs(binding) then
                binding[Shortcut.ACTION] = nil
                if isEmpty(binding) then data[section][g.id] = nil end
            end
        end
        local gesture = Shortcut.find(id)
        if gesture and (not gesture.reader_only or section == "gesture_reader") then
            data[section][id] = { [Shortcut.ACTION] = true }
        end
    end
    return true
end

-- Applies a choice through the running Gestures plugin, which owns the file.
function Shortcut.apply(gestures_plugin, id)
    if not gestures_plugin or type(gestures_plugin.data) ~= "table" then return false end
    Shortcut.bind(gestures_plugin.data, id)
    gestures_plugin.updated = true
    if gestures_plugin.onFlushSettings then gestures_plugin:onFlushSettings() end
    return true
end

return Shortcut
