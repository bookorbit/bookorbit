package.loaded["document/documentregistry"] = {
    hasProvider = function()
        return true
    end,
}

package.loaded["util"] = {
    fixUtf8 = function(value)
        return value
    end,
}

package.loaded["ffi/util"] = {
    template = function(value)
        return value
    end,
}

package.loaded["gettext"] = function(text)
    return text
end

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogUtil = require("bookorbit_catalog_util")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

assertEqual(
    CatalogUtil.readingStreakDays({ readingStreak = { currentStreak = 20 } }, 14),
    20,
    "account streak overrides local streak"
)
assertEqual(
    CatalogUtil.readingStreakDays({ readingStreak = { currentStreak = 0 } }, 14),
    0,
    "zero account streak overrides local streak"
)
assertEqual(CatalogUtil.readingStreakDays({}, 14), 14, "missing account streak falls back to local streak")
assertEqual(CatalogUtil.readingStreakDays(nil, nil), 0, "missing streak data falls back to zero")

-- Relative labels pick their bucket from the delta; the stubbed template
-- returns the raw format string, which is enough to prove branch selection.
local now = os.time()
local function iso(timestamp)
    return os.date("!%Y-%m-%dT%H:%M:%S", timestamp) .. ".000Z"
end
assertEqual(CatalogUtil.formatRelativeTime(iso(now - 30), now), "just now", "a fresh timestamp reads as just now")
assertEqual(CatalogUtil.formatRelativeTime(iso(now - 300), now), "%1 min ago", "minutes bucket")
assertEqual(CatalogUtil.formatRelativeTime(iso(now - 7200), now), "%1 h ago", "hours bucket")
assertEqual(CatalogUtil.formatRelativeTime(iso(now - math.floor(1.5 * 86400)), now), "yesterday", "one day reads as yesterday")
assertEqual(CatalogUtil.formatRelativeTime(iso(now - 5 * 86400), now), "%1 days ago", "days bucket")
assertEqual(CatalogUtil.formatRelativeTime(iso(now + 3600), now), "just now", "a future timestamp clamps to just now")
assertEqual(CatalogUtil.formatRelativeTime("not a timestamp", now), nil, "junk yields no label")
assertEqual(CatalogUtil.formatRelativeTime(nil, now), nil, "nil yields no label")

print("bookorbit_catalog_streak_test.lua: ok")
