-- The detail page's status sheet is the only place a device can undo its own
-- status write, so Unread has to be among the statuses a device may set.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local function identity(value) return value end

local function stubWidget()
    local widget = {}
    widget.__index = widget
    function widget:new(opts)
        opts = opts or {}
        return setmetatable(opts, widget)
    end
    function widget:extend(opts)
        local child = setmetatable(opts or {}, { __index = self })
        child.__index = child
        child.new = widget.new
        child.extend = widget.extend
        return child
    end
    function widget:getSize() return { w = 0, h = 0 } end
    return widget
end

local last_dialog
local ButtonDialog = {}
ButtonDialog.__index = ButtonDialog
function ButtonDialog:new(opts)
    last_dialog = setmetatable(opts or {}, ButtonDialog)
    return last_dialog
end

package.loaded["ui/bidi"] = { auto = identity, dirpath = identity, filepath = identity }
package.loaded["ffi/blitbuffer"] = { COLOR_GRAY = 0 }
package.loaded["ui/widget/button"] = stubWidget()
package.loaded["ui/widget/buttondialog"] = ButtonDialog
package.loaded["ui/widget/container/centercontainer"] = stubWidget()
package.loaded["ui/widget/container/leftcontainer"] = stubWidget()
package.loaded["ui/widget/container/inputcontainer"] = stubWidget()
package.loaded["ui/widget/horizontalgroup"] = stubWidget()
package.loaded["ui/widget/horizontalspan"] = stubWidget()
package.loaded["ui/widget/verticalgroup"] = stubWidget()
package.loaded["ui/widget/verticalspan"] = stubWidget()
package.loaded["ui/widget/linewidget"] = stubWidget()
package.loaded["ui/widget/textboxwidget"] = stubWidget()
package.loaded["ui/widget/textviewer"] = stubWidget()
package.loaded["ui/widget/infomessage"] = stubWidget()
package.loaded["ui/widget/keyvaluepage"] = stubWidget()
package.loaded["ui/geometry"] = stubWidget()
package.loaded["ui/gesturerange"] = stubWidget()
package.loaded["ui/font"] = { getFace = function() return { size = 12 } end }
package.loaded["ui/size"] = { line = { medium = 1 } }
package.loaded["ui/network/manager"] = { isConnected = function() return true end }
package.loaded["device"] = { screen = { scaleBySize = function(_, value) return value end } }
package.loaded["ui/uimanager"] = { show = function() end, close = function() end }
package.loaded["document/documentregistry"] = { hasProvider = function() return true end }
package.loaded["util"] = {
    trim = function(value) return tostring(value or ""):match("^%s*(.-)%s*$") end,
    fixUtf8 = function(value) return value end,
    htmlToPlainTextIfHtml = identity,
}
package.loaded["ffi/util"] = {
    template = function(pattern, a, b)
        return (pattern:gsub("%%1", tostring(a)):gsub("%%2", tostring(b)))
    end,
}
package.loaded["gettext"] = setmetatable({}, { __call = function(_, value) return value end })
package.loaded["bookorbit_catalog_widgets"] = { focusable = identity }
-- The page itself is drawn by bookorbit_detail_view; the dialog never touches it.
package.loaded["bookorbit_detail_view"] = {}

local CatalogUtil = require("bookorbit_catalog_util")
local CatalogDetail = require("bookorbit_catalog_detail")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)), 2)
    end
end

-- Settable statuses

local settable = {}
for index, status in ipairs(CatalogUtil.SETTABLE_READ_STATUSES) do
    settable[status.id] = index
    assertEqual(CatalogUtil.READ_STATUS_LABELS[status.id] ~= nil, true,
        status.id .. " has a display label")
end

assertEqual(settable.unread, 1, "the unread reset leads the list, matching the web dashboard order")
assertEqual(settable.want_to_read ~= nil, true, "want_to_read stays settable")
assertEqual(settable.reading ~= nil, true, "reading stays settable")
assertEqual(settable.on_hold ~= nil, true, "on_hold stays settable")
assertEqual(settable.read ~= nil, true, "read stays settable")
assertEqual(settable.abandoned ~= nil, true, "abandoned stays settable")
assertEqual(settable.rereading, nil, "rereading is server-derived, not device-settable")
assertEqual(settable.skimmed, nil, "skimmed is not offered on the device")
assertEqual(#CatalogUtil.SETTABLE_READ_STATUSES, 6, "no other status leaked into the dialog")

print("bookorbit_catalog_status_options_test.lua: ok")
