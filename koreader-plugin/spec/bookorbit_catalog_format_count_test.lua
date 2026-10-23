-- Count badges share a narrow column with their label, so the string is
-- bounded at four characters however large the library gets.

package.loaded["document/documentregistry"] = { hasProvider = function() return true end }
package.loaded["util"] = {
    fixUtf8 = function(value) return value end,
}
package.loaded["ffi/util"] = { template = function(value) return value end }
package.loaded["gettext"] = function(text) return text end

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogUtil = require("bookorbit_catalog_util")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local formatCount = CatalogUtil.formatCount

assertEqual(formatCount(0), "0", "zero is a count, not an absence")
assertEqual(formatCount(7), "7", "single digit")
assertEqual(formatCount(999), "999", "the last unscaled value")
assertEqual(formatCount(1000), "1K", "a whole thousand drops its decimal")
assertEqual(formatCount(1500), "1.5K", "a half thousand keeps one decimal")
assertEqual(formatCount(9999), "9.9K", "just under ten thousand")
assertEqual(formatCount(10000), "10K", "ten thousand and up lose the decimal")
assertEqual(formatCount(12431), "12K", "a large library")
assertEqual(formatCount(999999), "999K", "the last value before millions")
assertEqual(formatCount(1000000), "1M", "millions scale again")
assertEqual(formatCount(1500000), "1.5M", "millions keep one decimal")

-- Truncating, not rounding: a badge must never claim more books than are there,
-- and rounding 999999 up would carry it to a five-character "1000K".
assertEqual(formatCount(1999), "1.9K", "the scaled value truncates")
assertEqual(formatCount(1099), "1K", "truncation can drop the decimal entirely")

for _, value in ipairs({ 0, 7, 999, 1000, 1500, 9999, 10000, 999999, 1000000, 1500000 }) do
    assertEqual(#formatCount(value) <= 4, true, "the badge for " .. value .. " fits the column")
end

-- Anything that is not a usable count leaves the tile unbadged rather than
-- rendering a placeholder into the grid.
for _, value in ipairs({ "many", -1 }) do
    assertEqual(formatCount(value), nil, "unusable count " .. tostring(value) .. " has no badge")
end
assertEqual(formatCount(nil), nil, "a missing count has no badge")
assertEqual(formatCount({}), nil, "a malformed count has no badge")

-- A count arriving as a numeric string still counts, since the payload is JSON.
assertEqual(formatCount("1500"), "1.5K", "a numeric string is accepted")

print("bookorbit_catalog_format_count_test.lua: ok")
