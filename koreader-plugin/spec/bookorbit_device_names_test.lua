-- The progress prompt names the device holding the other position the way
-- people know it, not by the model id KOReader reports.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local DeviceNames = require("bookorbit_device_names")

local function assertEqual(actual, expected, label)
    if actual ~= expected then error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual))) end
end

assertEqual(DeviceNames.label("Kobo_monza"), "Kobo Libra Colour", "a Kobo codename becomes its retail name")
assertEqual(DeviceNames.label("Kobo_spaBW"), "Kobo Clara BW", "the newest Kobos are known")
assertEqual(DeviceNames.label("KindlePaperWhite5"), "Kindle Paperwhite 5", "Kindle model ids read as names")
assertEqual(DeviceNames.label("macOS"), "macOS", "an unknown device shows as reported")
assertEqual(DeviceNames.label(""), nil, "an empty name is no name")
assertEqual(DeviceNames.label(nil), nil, "a missing name is no name")

print("bookorbit_device_names_test.lua: ok")
