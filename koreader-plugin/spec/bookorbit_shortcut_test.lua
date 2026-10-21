-- Proves the one-tap BookOrbit shortcut: what a gesture would replace is named
-- per section, picking one binds it in supported contexts and
-- releases any other offered gesture, and "No shortcut" leaves other actions
-- alone.

package.loaded["gettext"] = function(text)
    return text
end

package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index)
            return tostring(values[tonumber(index)])
        end))
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local Shortcut = require("bookorbit_shortcut")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function name_of(binding)
    if binding.toggle_bookmark then return "Toggle bookmark" end
    if binding.toggle_page_flipping then return "Page browser" end
    return "Something"
end

-- A fresh KOReader: the corner tap is Bookmark in books only.
local data = {
    gesture_fm = {},
    gesture_reader = { tap_top_right_corner = { toggle_bookmark = true } },
}

local text, replaces = Shortcut.describe(data, "hold_top_left_corner", name_of)
assertEqual(text, "Free", "an unused gesture is free")
assertEqual(replaces, false, "a free gesture replaces nothing")
text, replaces = Shortcut.describe(data, "tap_top_right_corner", name_of)
assertEqual(text, "In books, replaces Toggle bookmark", "a reader-only binding is named for books")
assertEqual(replaces, true, "a bound gesture replaces something")

data.gesture_fm.tap_top_right_corner = { toggle_bookmark = true }
text = Shortcut.describe(data, "tap_top_right_corner", name_of)
assertEqual(text, "In books, replaces Toggle bookmark", "unsupported file-browser binding is ignored")
data.gesture_fm.tap_top_right_corner = { toggle_page_flipping = true }
text = Shortcut.describe(data, "tap_top_right_corner", name_of)
assertEqual(text, "In books, replaces Toggle bookmark", "unsupported conflicting file-browser action is preserved")
data.gesture_fm.tap_top_right_corner = nil

-- Reader-only gestures leave the file browser alone.
assertEqual(Shortcut.current(data), nil, "no shortcut to begin with")
Shortcut.bind(data, "hold_top_left_corner")
assertEqual(data.gesture_fm.hold_top_left_corner, nil, "reader-only gesture is not bound in the file browser")
assertEqual(data.gesture_reader.hold_top_left_corner[Shortcut.ACTION], true, "bound in books")
assertEqual(Shortcut.current(data), "hold_top_left_corner", "the bound gesture is the current one")
text = Shortcut.describe(data, "hold_top_left_corner", name_of)
assertEqual(text, "Opens BookOrbit", "the current gesture says so")

-- Picking a shared gesture releases the first and binds both contexts.
Shortcut.bind(data, "tap_right_bottom_corner")
assertEqual(data.gesture_fm.hold_top_left_corner, nil, "the old gesture is released in the file browser")
assertEqual(data.gesture_reader.hold_top_left_corner, nil, "the old gesture is released in books")
assertEqual(Shortcut.current(data), "tap_right_bottom_corner", "the new gesture is current")
assertEqual(data.gesture_fm.tap_right_bottom_corner[Shortcut.ACTION], true, "shared gesture binds Files")
assertEqual(data.gesture_reader.tap_right_bottom_corner[Shortcut.ACTION], true, "shared gesture binds books")

-- Replacing a bound gesture overwrites it; "No shortcut" only removes ours.
data.gesture_fm.tap_top_right_corner = { toggle_page_flipping = true }
Shortcut.bind(data, "tap_top_right_corner")
assertEqual(data.gesture_fm.tap_top_right_corner.toggle_page_flipping, true, "reader-only selection preserves the Files action")
assertEqual(data.gesture_fm.tap_top_right_corner[Shortcut.ACTION], nil, "reader-only selection does not bind Files")
assertEqual(data.gesture_reader.tap_top_right_corner.toggle_bookmark, nil, "the replaced action is gone")
data.gesture_reader.tap_right_bottom_corner = { [Shortcut.ACTION] = true, toggle_frontlight = true }
Shortcut.bind(data, nil)
assertEqual(Shortcut.current(data), nil, "no shortcut after choosing none")
assertEqual(data.gesture_reader.tap_top_right_corner, nil, "our binding is removed")
assertEqual(data.gesture_reader.tap_right_bottom_corner.toggle_frontlight, true, "another action on a shared gesture stays")

-- Two-finger gestures are only offered on multi-touch screens.
assertEqual(#Shortcut.available(false), 3, "single-touch screens get three gestures")
assertEqual(#Shortcut.available(true), 4, "multi-touch screens get all four")

-- Applying goes through the Gestures plugin, which flushes its own file.
local flushed = false
local gestures = { data = { gesture_fm = {}, gesture_reader = {} } }
function gestures:onFlushSettings() flushed = self.updated end
assertEqual(Shortcut.apply(gestures, "hold_top_left_corner"), true, "apply succeeds with the plugin running")
assertEqual(flushed, true, "the plugin flushes after the change")
assertEqual(Shortcut.apply(nil, "hold_top_left_corner"), false, "apply reports a disabled Gestures plugin")

print("bookorbit_shortcut_test.lua: ok")
