--[[
Reads a gettext .po catalog. Used by bookorbit_gettext.lua on the device and
by the catalog check that CI runs, so both read a file the same way.

Po.parse(content) returns the entries in file order and the header text. An
entry has msgid, and when present msgctxt, msgid_plural, msgstr (a singular
translation) or [0], [1]... (the plural forms), fuzzy = true and flags (the
words on its "#," line). Obsolete "#~" entries are left out.
]]

local Po = {}

local ESCAPES = { n = "\n", t = "\t", r = "\r", ['"'] = '"', ["\\"] = "\\" }

local function unescape(text)
    return (text:gsub("\\(.)", function(c) return ESCAPES[c] or ("\\" .. c) end))
end

function Po.parse(content)
    local entries, header = {}, nil
    local entry, field = {}, nil

    local function flush()
        if entry.msgid == "" and not entry.msgctxt then
            header = entry.msgstr or ""
        elseif entry.msgid then
            table.insert(entries, entry)
        end
        entry, field = {}, nil
    end

    local function hasTranslation()
        return entry.msgstr ~= nil or entry[0] ~= nil
    end

    content = content:gsub("^\239\187\191", "")
    for line in (content .. "\n"):gmatch("(.-)\r?\n") do
        local keyword, index, text = line:match('^(msg[%a_]+)%[?(%d*)%]?%s+"(.*)"%s*$')
        if keyword then
            -- A new msgctxt or msgid after a translation starts the next
            -- entry, even without the blank line between them.
            if (keyword == "msgctxt" or keyword == "msgid") and hasTranslation() then flush() end
            field = index ~= "" and tonumber(index) or keyword
            entry[field] = unescape(text)
        elseif field and line:match('^%s*".*"%s*$') then
            entry[field] = entry[field] .. unescape(line:match('^%s*"(.*)"%s*$'))
        elseif line:match("^#,") then
            if hasTranslation() then flush() end
            entry.flags = line:sub(3)
            if line:find("fuzzy", 3, true) then entry.fuzzy = true end
        elseif line:match("^#") then
            if hasTranslation() then flush() end
        elseif not line:find("%S") then
            flush()
        end
    end
    flush()
    return entries, header or ""
end

-- The value of one header field ("Language", "Plural-Forms"...), or nil.
function Po.headerField(header, name)
    for line in ((header or "") .. "\n"):gmatch("(.-)\n") do
        local key, value = line:match("^([^:]+):%s*(.-)%s*$")
        if key == name then return value end
    end
end

-- The translations of an entry as a list of forms: { msgstr } for a singular
-- entry, { [0], [1], ... } in order for a plural one.
function Po.forms(entry)
    if not entry.msgid_plural then return { entry.msgstr or "" } end
    local forms, i = {}, 0
    while entry[i] ~= nil do
        table.insert(forms, entry[i])
        i = i + 1
    end
    return forms
end

return Po
