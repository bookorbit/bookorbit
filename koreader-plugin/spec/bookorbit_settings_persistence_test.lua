local file = assert(io.open("koreader-plugin/bookorbit.koplugin/bookorbit_settings_page.lua"))
local source = file:read("*a")
file:close()
local block = assert(source:match("(local function onAction.-)\nlocal function onBack"))
local settings = { pages_before_update = 998 }
local saved, saved_scale, applied_scale, catalog_redraws, redraws = nil, nil, nil, 0, 0
local page = {
    plugin = {
        settings = settings,
        setPagesBeforeUpdate = function(_, value) settings.pages_before_update = value end,
    },
    catalog = {
        interfaceScaleChanged = function() catalog_redraws = catalog_redraws + 1 end,
    },
    refresh = function()
        assert(saved == settings.pages_before_update, "the interval persists before redraw")
        redraws = redraws + 1
    end,
}
local env = setmetatable({
    BoardMetrics = { setUserScale = function(value) applied_scale = value; return value end },
    G_reader_settings = { flush = function() saved, saved_scale = settings.pages_before_update, settings.ui_scale end },
}, { __index = _G })
local chunk = assert(loadstring(block .. "\nreturn onAction"))
setfenv(chunk, env)
local action = chunk()
action(page, { kind = "push", delta = 1 })
assert(saved == 999 and redraws == 1, "a changed interval is durable before the row redraws")
action(page, { kind = "push", delta = 1 })
assert(saved == 999, "the maximum interval remains durable on repeated input")
settings.pages_before_update = 0
action(page, { kind = "push", delta = -1 })
assert(saved == 0, "the disabled interval remains durable at the lower boundary")
action(page, { kind = "push", delta = 1 })
assert(saved == 1, "enabling periodic pushes persists without a later unrelated setting change")
action(page, { kind = "ui-scale", value = 1.2 })
assert(applied_scale == 1.2 and saved_scale == 1.2, "interface size is applied and persisted before redraw")
assert(catalog_redraws == 1, "the catalog behind settings is rebuilt at the new interface size")
file = assert(io.open("koreader-plugin/bookorbit.koplugin/main.lua"))
source = file:read("*a")
file:close()
block = assert(source:match("(function BookOrbit:onBookOrbitToggleAutoSync.-)\nfunction BookOrbit:registerEvents"))
local auto_saved, pulls, pushes, unscheduled = false, 0, 0, 0
local plugin = { settings = { auto_sync = false }, page_update_counter = 7, periodic_push_scheduled = true }
function plugin:registerEvents()
    assert(auto_saved == self.settings.auto_sync, "auto-sync persists before changing lifecycle handlers")
end
function plugin:requestProgressPull()
    assert(auto_saved == true, "enabling persists before requesting a pull")
    pulls = pulls + 1
end
function plugin:requestProgressPush()
    assert(auto_saved == false, "disabling persists before requesting a push")
    pushes = pushes + 1
end
env = setmetatable({
    BookOrbit = {},
    Device = { hasSeamlessWifiToggle = function() return false end },
    G_reader_settings = { flush = function() auto_saved = plugin.settings.auto_sync end },
    UIManager = { unschedule = function() unscheduled = unscheduled + 1 end },
}, { __index = _G })
chunk = assert(loadstring(block .. "\nreturn BookOrbit.onBookOrbitToggleAutoSync"))
setfenv(chunk, env)
local toggle = chunk()
toggle(plugin, nil, true, true)
assert(auto_saved == true and pulls == 1, "row activation durably enables automatic sync")
toggle(plugin, nil, true, true)
assert(auto_saved == false and pushes == 1 and unscheduled == 1, "toggle activation durably disables automatic sync")
assert(plugin.page_update_counter == 0 and plugin.periodic_push_scheduled == false)
toggle(plugin, false, true, true)
assert(pulls == 1 and pushes == 1, "an unchanged explicit value does not start more work")
print("bookorbit_settings_persistence_test.lua: ok")
