--[[--
Pins the BookOrbit menu entry onto the first page of the Tools menu, right
below calibre, and puts BookOrbit's icon in KOReader's menu bar just before
the main menu, by maintaining user menu-order override files.

KOReader merges <settings_dir>/<prefix>_menu_order.lua over the bundled order
tables per top-level key, so the generated files must carry the complete tools
list. Files created here start with a marker comment and are regenerated from
the bundled order on every startup, so KOReader updates never drift. A
hand-maintained file only ever gets old BookOrbit ids replaced by the current
one.
]]

local DataStorage = require("datastorage")
local dump = require("dump")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")

local MARKER = "-- bookorbit-menu-pin v3 (generated; delete this file to reset menu order)"
local OLD_MARKERS = {
    "-- bookorbit-sync-pin v1 (generated; delete this file to reset menu order)",
    "-- bookorbit-menu-pin v2 (generated; delete this file to reset menu order)",
}
local TAB_ID = "bookorbit_tab"
local BUTTONS = "KOMenu:menu_buttons"
local MENU_ID = "bookorbit"
local OLD_MENU_IDS = {
    "bookorbit_browse",
    "bookorbit_sync",
}

local PREFIXES = {
    { prefix = "reader", order_module = "ui/elements/reader_menu_order" },
    { prefix = "filemanager", order_module = "ui/elements/filemanager_menu_order" },
}

local BookOrbitMenuPin = {
    done = false,
    -- Whether BookOrbit's icon belongs in the menu bar; set from the
    -- plugin's setting before ensure or refresh runs.
    tab = true,
}

local function removeId(tools, menu_id)
    local removed = false
    for i = #tools, 1, -1 do
        if tools[i] == menu_id then
            table.remove(tools, i)
            removed = true
        end
    end
    return removed
end

local function removeOldIds(tools)
    local removed = false
    for _, menu_id in ipairs(OLD_MENU_IDS) do
        removed = removeId(tools, menu_id) or removed
    end
    return removed
end

local function normalizeBookOrbitIds(tools)
    removeOldIds(tools)
    removeId(tools, MENU_ID)

    local insert_at = #tools
    for i, id in ipairs(tools) do
        if id == "calibre" then
            insert_at = i
            break
        end
    end

    table.insert(tools, insert_at + 1, MENU_ID)
end

-- The menu bar with BookOrbit's tab just before the main menu (the last
-- button), or without it.
local function normalizeButtons(buttons, with_tab)
    removeId(buttons, TAB_ID)
    if not with_tab then return end
    local insert_at = #buttons + 1
    for i, id in ipairs(buttons) do
        if id == "main" then
            insert_at = i
            break
        end
    end
    table.insert(buttons, insert_at, TAB_ID)
end
BookOrbitMenuPin.normalizeButtons = normalizeButtons

local function copyList(list)
    local out = {}
    for _, id in ipairs(list) do table.insert(out, id) end
    return out
end

local function desiredOrder(order_module)
    local bundled = require(order_module)
    if type(bundled) ~= "table" or type(bundled.tools) ~= "table" then
        return nil
    end
    local order = { tools = copyList(bundled.tools) }
    normalizeBookOrbitIds(order.tools)
    if type(bundled[BUTTONS]) == "table" then
        order[BUTTONS] = copyList(bundled[BUTTONS])
        normalizeButtons(order[BUTTONS], BookOrbitMenuPin.tab)
        -- MenuSorter treats a button as a tab only when it has an order list.
        if BookOrbitMenuPin.tab then order[TAB_ID] = {} end
    end
    return order
end

local function serializeOurs(order)
    return MARKER .. "\nreturn " .. dump(order, nil, true) .. "\n"
end

local function isGeneratedByUs(existing)
    if existing:sub(1, #MARKER) == MARKER then
        return true
    end
    for _, marker in ipairs(OLD_MARKERS) do
        if existing:sub(1, #marker) == marker then
            return true
        end
    end
    return false
end

local function ensureOne(prefix, order_module)
    local order = desiredOrder(order_module)
    if not order then return end

    local path = DataStorage:getSettingsDir() .. "/" .. prefix .. "_menu_order.lua"

    if not lfs.attributes(path) then
        local ok, err = util.writeToFile(serializeOurs(order), path, true)
        if not ok then
            logger.warn("BookOrbit: cannot write menu order file", path, err)
        end
        return
    end

    local existing = util.readFromFile(path, "r")
    if not existing then
        logger.warn("BookOrbit: cannot read menu order file, leaving it alone:", path)
        return
    end

    if isGeneratedByUs(existing) then
        local content = serializeOurs(order)
        if content ~= existing then
            local ok, err = util.writeToFile(content, path, true)
            if not ok then
                logger.warn("BookOrbit: cannot update menu order file", path, err)
            end
        end
        return
    end

    -- Hand-maintained file: replace stale BookOrbit ids without touching other entries.
    local parsed, user = pcall(dofile, path)
    if not parsed or type(user) ~= "table" then
        logger.warn("BookOrbit: cannot parse user menu order file, leaving it alone:", path)
        return
    end
    if type(user.tools) == "table" then
        normalizeBookOrbitIds(user.tools)
    else
        user.tools = order.tools
    end
    -- A hand-kept menu bar keeps its own order; only BookOrbit's tab moves.
    if type(user[BUTTONS]) == "table" then
        normalizeButtons(user[BUTTONS], BookOrbitMenuPin.tab)
    elseif order[BUTTONS] then
        user[BUTTONS] = order[BUTTONS]
    end
    user[TAB_ID] = BookOrbitMenuPin.tab and {} or nil
    local ok, err = util.writeToFile(dump(user, nil, true), path, true, true)
    if not ok then
        logger.warn("BookOrbit: cannot update user menu order file", path, err)
    end
end

local function ensureAll()
    for _, entry in ipairs(PREFIXES) do
        local ok, err = pcall(ensureOne, entry.prefix, entry.order_module)
        if not ok then
            logger.warn("BookOrbit: menu pin failed for", entry.prefix, err)
        end
    end
end

function BookOrbitMenuPin.ensure(with_tab)
    if BookOrbitMenuPin.done then return end
    BookOrbitMenuPin.done = true
    if with_tab ~= nil then BookOrbitMenuPin.tab = with_tab end
    ensureAll()
end

-- Rewrites both order files after the menu bar setting changes.
function BookOrbitMenuPin.refresh(with_tab)
    BookOrbitMenuPin.tab = with_tab ~= false
    BookOrbitMenuPin.done = true
    ensureAll()
end

return BookOrbitMenuPin
