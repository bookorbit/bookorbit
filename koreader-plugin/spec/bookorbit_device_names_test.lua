-- The progress prompt names the device holding the other position the way
-- people know it: by the name it was given in BookOrbit, else by the name on
-- the box, never by the model id KOReader reports.

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

assertEqual(DeviceNames.label("blazer", "Pixel 8"), "Pixel 8", "a name given in BookOrbit wins over the model")
assertEqual(DeviceNames.label("Kobo_monza", "  Bedside Kobo  "), "Bedside Kobo", "a given name is trimmed")
assertEqual(DeviceNames.label("Kobo_monza", ""), "Kobo Libra Colour", "an empty given name falls back to the model")
assertEqual(DeviceNames.label("Kobo_monza", "   "), "Kobo Libra Colour", "a blank given name falls back to the model")
assertEqual(DeviceNames.label("Kobo_monza", "Two\nlines"), "Kobo Libra Colour", "a multi-line name is ignored")
assertEqual(DeviceNames.label("Kobo_monza", 42), "Kobo Libra Colour", "a name that is not a string is ignored")
assertEqual(DeviceNames.label("blazer", nil), "blazer", "older servers send no name")
assertEqual(DeviceNames.label(nil, "Pixel 8"), "Pixel 8", "a given name needs no model")
assertEqual(DeviceNames.label("blazer", "Liseuse de Léa"), "Liseuse de Léa", "names outside ASCII are kept")

print("bookorbit_device_names_test.lua: ok")
