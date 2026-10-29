--[[--
Pins the BookOrbit menu entry onto the first page of the Tools menu, right
below calibre, and puts BookOrbit's icon in KOReader's menu bar just before
the main menu.

KOReader caches its bundled menu-order tables and lets plugins extend them
before the menu is built. Mutating those shared tables preserves entries added
by every plugin regardless of load order. Older BookOrbit releases instead
wrote complete user override lists, which hid entries added by later plugins;
those marker-owned files are removed during migration. A hand-maintained file
keeps its other entries and only has BookOrbit ids normalized.
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

local EMPTY_OVERRIDE = MARKER .. "\nreturn {}\n"

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

local function normalizeRuntimeOrder(order)
    if type(order) ~= "table" or type(order.tools) ~= "table" then return end
    normalizeBookOrbitIds(order.tools)
    if type(order[BUTTONS]) == "table" then
        normalizeButtons(order[BUTTONS], BookOrbitMenuPin.tab)
        -- MenuSorter treats a button as a tab only when it has an order list.
        order[TAB_ID] = BookOrbitMenuPin.tab and {} or nil
    end
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

local function migrateOverride(prefix)
    local path = DataStorage:getSettingsDir() .. "/" .. prefix .. "_menu_order.lua"
    if not lfs.attributes(path) then return end

    local existing = util.readFromFile(path, "r")
    if not existing then
        logger.warn("BookOrbit: cannot read menu order file, leaving it alone:", path)
        return
    end

    if isGeneratedByUs(existing) then
        local ok, err = os.remove(path)
        if not ok then
            local cleared, clear_err = util.writeToFile(EMPTY_OVERRIDE, path, true)
            if not cleared then
                logger.warn("BookOrbit: cannot clear generated menu order file", path, err, clear_err)
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
    end
    if type(user[BUTTONS]) == "table" then
        normalizeButtons(user[BUTTONS], BookOrbitMenuPin.tab)
        user[TAB_ID] = BookOrbitMenuPin.tab and {} or nil
    else
        user[TAB_ID] = nil
    end
    local ok, err = util.writeToFile(dump(user, nil, true), path, true, true)
    if not ok then
        logger.warn("BookOrbit: cannot update user menu order file", path, err)
    end
end

local function ensureOne(prefix, order_module)
    local ok, order = pcall(require, order_module)
    if not ok then
        logger.warn("BookOrbit: cannot load menu order", order_module, order)
        return
    end
    normalizeRuntimeOrder(order)
    migrateOverride(prefix)
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

-- Updates both cached orders after the menu bar setting changes.
function BookOrbitMenuPin.refresh(with_tab)
    BookOrbitMenuPin.tab = with_tab ~= false
    BookOrbitMenuPin.done = true
    ensureAll()
end

return BookOrbitMenuPin
