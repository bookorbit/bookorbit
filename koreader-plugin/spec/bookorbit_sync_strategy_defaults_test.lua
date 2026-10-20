local file = assert(io.open("koreader-plugin/bookorbit.koplugin/main.lua"))
local source = file:read("*a")
file:close()
local block = assert(source:match("(    if self.settings.sync_forward == nil then.-)    if self.settings.update_check_last_at"))
local apply = assert(loadstring("return function(self)\n" .. block .. "end"))()
local plugin = { settings = {}, default_settings = { sync_forward = 1, sync_backward = 3 } }
apply(plugin)
assert(plugin.settings.sync_forward == 1, "an unset forward strategy must match the displayed Ask default")
assert(plugin.settings.sync_backward == 3, "an unset backward strategy must match the displayed Stay default")
plugin.settings = { sync_forward = 3, sync_backward = 2 }
apply(plugin)
assert(plugin.settings.sync_forward == 3 and plugin.settings.sync_backward == 2, "existing choices must survive startup")
plugin.settings = { sync_forward = 2 }
apply(plugin)
assert(plugin.settings.sync_forward == 2 and plugin.settings.sync_backward == 3, "only missing strategies receive defaults")
print("bookorbit_sync_strategy_defaults_test.lua: ok")
