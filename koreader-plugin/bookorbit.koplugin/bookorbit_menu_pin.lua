--[[--
Pins the BookOrbit menu entry onto the first page of the Tools menu, right
below calibre, by maintaining user menu-order override files.

KOReader merges <settings_dir>/<prefix>_menu_order.lua over the bundled order
tables per top-level key, so the generated files must carry the complete tools
list. Files created here start with a marker comment and are regenerated from
the bundled order on every startup, so KOReader updates never drift. A
hand-maintained file only ever gets the single bookorbit_sync id inserted.
]]

local DataStorage = require("datastorage")
local dump = require("dump")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")

local MARKER = "-- bookorbit-sync-pin v1 (generated; delete this file to reset menu order)"
local MENU_ID = "bookorbit_sync"

local PREFIXES = {
    { prefix = "reader", order_module = "ui/elements/reader_menu_order" },
    { prefix = "filemanager", order_module = "ui/elements/filemanager_menu_order" },
}

local BookOrbitMenuPin = {
    done = false,
}

local function insertAfterCalibre(tools)
    for i, id in ipairs(tools) do
        if id == "calibre" then
            table.insert(tools, i + 1, MENU_ID)
            return
        end
    end
    table.insert(tools, MENU_ID)
end

local function desiredTools(order_module)
    local bundled = require(order_module)
    if type(bundled) ~= "table" or type(bundled.tools) ~= "table" then
        return nil
    end
    local tools = {}
    for _, id in ipairs(bundled.tools) do
        table.insert(tools, id)
    end
    insertAfterCalibre(tools)
    return tools
end

local function serializeOurs(tools)
    return MARKER .. "\nreturn " .. dump({ tools = tools }, nil, true) .. "\n"
end

local function containsId(tools)
    for _, id in ipairs(tools) do
        if id == MENU_ID then return true end
    end
    return false
end

local function ensureOne(prefix, order_module)
    local tools = desiredTools(order_module)
    if not tools then return end

    local path = DataStorage:getSettingsDir() .. "/" .. prefix .. "_menu_order.lua"

    if not lfs.attributes(path) then
        local ok, err = util.writeToFile(serializeOurs(tools), path, true)
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

    if existing:sub(1, #MARKER) == MARKER then
        local content = serializeOurs(tools)
        if content ~= existing then
            local ok, err = util.writeToFile(content, path, true)
            if not ok then
                logger.warn("BookOrbit: cannot update menu order file", path, err)
            end
        end
        return
    end

    -- Hand-maintained file: only ever insert our id, never restructure.
    local parsed, user = pcall(dofile, path)
    if not parsed or type(user) ~= "table" then
        logger.warn("BookOrbit: cannot parse user menu order file, leaving it alone:", path)
        return
    end
    if type(user.tools) == "table" then
        if containsId(user.tools) then return end
        insertAfterCalibre(user.tools)
    else
        user.tools = tools
    end
    local ok, err = util.writeToFile(dump(user, nil, true), path, true, true)
    if not ok then
        logger.warn("BookOrbit: cannot update user menu order file", path, err)
    end
end

function BookOrbitMenuPin.ensure()
    if BookOrbitMenuPin.done then return end
    BookOrbitMenuPin.done = true
    for _, entry in ipairs(PREFIXES) do
        local ok, err = pcall(ensureOne, entry.prefix, entry.order_module)
        if not ok then
            logger.warn("BookOrbit: menu pin failed for", entry.prefix, err)
        end
    end
end

return BookOrbitMenuPin
