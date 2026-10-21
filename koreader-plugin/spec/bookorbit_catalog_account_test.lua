local file = assert(io.open("koreader-plugin/bookorbit.koplugin/bookorbit_catalog.lua"))
local source = file:read("*a")
file:close()

local accounts, closed, released, dashboards, hydrations = {}, {}, 0, 0, 0
local catalog = {
    settings = {},
    bulkReleaseStandby = function() released = released + 1 end,
    goDashboard = function(self)
        dashboards = dashboards + 1
        self.stack = {}
    end,
    hydrateOnDeviceMaps = function() hydrations = hydrations + 1 end,
}
local env = setmetatable({
    BookOrbitCatalog = catalog,
    BookOrbitStateManager = { setAccount = function(api) table.insert(accounts, api) end },
    BookOrbitApi = { new = function(api) return api end },
    UIManager = { close = function(_, widget) table.insert(closed, widget) end },
}, { __index = _G })
local chunk = assert(loadstring(assert(source:match("(function BookOrbitCatalog:setApi.-)\nfunction BookOrbitCatalog:init"))))
setfenv(chunk, env)
chunk()

local first = { server_url = "https://books.example/api/v1", username = "first", userkey = "key" }
catalog:setApi(first)
local generation = catalog.download_generation
catalog.settings.catalog_dashboard_cache = { private = true }
catalog.settings.catalog_recent_searches = { "private search" }
catalog.list_libraries = { { id = 1 } }
catalog._list_keep_jump = { from = { private = true } }
catalog.bulk_selected_books = { [1] = { id = 1 } }
catalog.bulk_selection_mode, catalog.bulk_select_all = true, true
catalog.on_device, catalog.on_device_files = { [1] = "book.epub" }, { [2] = "book.epub" }
catalog:setApi(first)
assert(catalog.settings.catalog_dashboard_cache.private, "rebinding the same account retains its cache")
assert(catalog.download_generation == generation, "rebinding does not cancel the same account's download")

local progress = {}
local bulk = { progress_dialog = progress }
catalog.bulk_ctx, catalog.bulk_running = bulk, true
catalog.current_context, catalog.stack = { kind = "books" }, { { kind = "detail" } }
local second = { server_url = first.server_url, username = "second", userkey = "other" }
catalog:setApi(second)
assert(catalog.api == second and catalog.client == second)
assert(catalog.settings.catalog_dashboard_cache == nil and catalog.settings.catalog_recent_searches == nil)
assert(catalog.list_libraries == nil and catalog._list_keep_jump == nil, "account switch clears widget-board list caches")
assert(next(catalog.bulk_selected_books) == nil and not catalog.bulk_selection_mode and not catalog.bulk_select_all)
assert(next(catalog.on_device) == nil and next(catalog.on_device_files) == nil)
assert(bulk.cancelled and catalog.bulk_ctx == nil and not catalog.bulk_running)
assert(released == 1 and closed[1] == progress, "replaced bulk run closes its progress and releases standby")
assert(catalog.download_generation > generation, "old single-download results lose publication ownership")
assert(dashboards == 1 and hydrations == 1 and #catalog.stack == 0)
assert(#accounts == 3 and accounts[3] == second)

generation = catalog.download_generation
catalog:setApi({ server_url = second.server_url, username = second.username })
assert(catalog.download_generation > generation, "logout invalidates authenticated work")
assert(dashboards == 2 and hydrations == 2)

print("bookorbit_catalog_account_test.lua: ok")
