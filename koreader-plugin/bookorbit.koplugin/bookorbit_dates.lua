--[[
Month names for dates the plugin writes. A month on its own (a calendar
heading, "November") comes from KOReader's translations. A month inside a date
("24 November", "late November 2025") has entries of its own, because several
languages write it differently there: Russian puts it in the genitive
(24 ноября, not 24 ноябрь) and Spanish in lower case (24 de noviembre). A
language whose plugin catalog lacks those entries gets KOReader's names, as
before.
]]

local T = require("ffi/util").template
local _ = require("bookorbit_gettext")

local Dates = {}

local LONG = { "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December" }
local SHORT = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" }

-- Literal calls, so the template extraction finds every name.
local function inDate(long)
    if long then
        return {
            -- TRANSLATORS: each month as it reads inside a date, after a day number ("24 November"): use the form your language needs there, such as the genitive in Russian or lower case in Spanish.
            _.pgettext("Month in a date", "January"), _.pgettext("Month in a date", "February"),
            _.pgettext("Month in a date", "March"), _.pgettext("Month in a date", "April"),
            _.pgettext("Month in a date", "May"), _.pgettext("Month in a date", "June"),
            _.pgettext("Month in a date", "July"), _.pgettext("Month in a date", "August"),
            _.pgettext("Month in a date", "September"), _.pgettext("Month in a date", "October"),
            _.pgettext("Month in a date", "November"), _.pgettext("Month in a date", "December"),
        }
    end
    return {
        -- TRANSLATORS: each short month as it reads inside a date ("24 Nov"), in the form your language needs there.
        _.pgettext("Short month in a date", "Jan"), _.pgettext("Short month in a date", "Feb"),
        _.pgettext("Short month in a date", "Mar"), _.pgettext("Short month in a date", "Apr"),
        _.pgettext("Short month in a date", "May"), _.pgettext("Short month in a date", "Jun"),
        _.pgettext("Short month in a date", "Jul"), _.pgettext("Short month in a date", "Aug"),
        _.pgettext("Short month in a date", "Sep"), _.pgettext("Short month in a date", "Oct"),
        _.pgettext("Short month in a date", "Nov"), _.pgettext("Short month in a date", "Dec"),
    }
end

local function koreaderName(key, long)
    local ok, datetime = pcall(require, "datetime")
    if not ok or type(datetime) ~= "table" then return key end
    local names = long and datetime.longMonthTranslation or datetime.shortMonthTranslation
    return type(names) == "table" and names[key] or key
end

-- Month 1-12 as it reads inside a date.
function Dates.monthInDate(month, long)
    local key = (long and LONG or SHORT)[tonumber(month)]
    if not key then return tostring(month or "") end
    local name = inDate(long)[tonumber(month)]
    if name == key then return koreaderName(key, long) end
    return name
end

-- "Nov 1": a timestamp's day and short month.
function Dates.shortDayMonth(t)
    -- TRANSLATORS: %1 is the short month as it reads inside a date, %2 the day of the month.
    return T(_.pgettext("Month and day", "%1 %2"), Dates.monthInDate(os.date("%m", t), false), tonumber(os.date("%d", t)))
end

return Dates
