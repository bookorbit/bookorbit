local function read(path)
    local file = assert(io.open(path))
    local source = file:read("*a")
    file:close()
    return source
end

local source = read("koreader-plugin/bookorbit.koplugin/bookorbit_catalog.lua")
local catalog = { settings = {}, on_device = {}, on_device_files = {} }
local modes, checks = {}, 0
local env = setmetatable({
    BookOrbitCatalog = catalog,
    lfs = { attributes = function(path)
        checks = checks + 1
        return modes[path]
    end },
}, { __index = _G })
local chunk = assert(loadstring(assert(source:match("(function BookOrbitCatalog:onDeviceBookPath.-)\nfunction BookOrbitCatalog:readStatusLabel"))))
setfenv(chunk, env)
chunk()

local path = "/path/to/library/book.epub"
catalog.on_device[1] = path
catalog.on_device_files[10] = path
assert(catalog:onDeviceBookPath({ id = 1 }) == nil)
assert(not catalog:isOnDevice({ id = 1 }))
assert(catalog:dashboardResumePath({ id = 1 }) == nil)
assert(catalog:onDeviceFilePath({ id = 10 }) == nil)
local generation, invalidations, hydrations = 1, 0, 0
env.BookOrbitStateManager = {
    generation = function() return generation end,
    invalidate = function() generation = generation + 1; invalidations = invalidations + 1 end,
}
function catalog:hydrateOnDeviceMaps() hydrations = hydrations + 1 end
catalog.on_device_generation = generation
catalog:onDeviceBookPath({ id = 1 })
catalog:onDeviceBookPath({ id = 1 })
assert(invalidations == 1 and hydrations == 1, "observing stale paths starts one asynchronous map reconciliation")
catalog.on_device_generation = nil
modes[path] = "directory"
assert(catalog:dashboardResumePath({ id = 1 }) == nil)
modes[path] = "file"
assert(catalog:isOnDevice({ id = 1 }))
assert(catalog:dashboardResumePath({ id = 1 }) == path)
assert(catalog:onDeviceFilePath({ id = 10 }) == path)
catalog.settings.catalog_dashboard_tap_resumes = false
assert(catalog:dashboardResumePath({ id = 1 }) == nil)

package.loaded["bookorbit_delivery"] = { key = function() return "account" end }
catalog.settings.catalog_downloaded_variants = { ["account|10|original"] = { path = path, selection = "current" } }
local file = { id = 10, selection = "current", downloadVariant = "original" }
assert(catalog:onDeviceFilePath(file) == path)
file.selection = "expired"
assert(catalog:onDeviceFilePath(file) == nil)
file.selection = "current"
modes[path] = nil
assert(catalog:onDeviceFilePath(file) == nil)

local detail_source = read("koreader-plugin/bookorbit.koplugin/bookorbit_catalog_detail.lua")
env.CatalogDetail = catalog
local detail_chunk = assert(loadstring(assert(detail_source:match("(function CatalogDetail:detailReadPath.-)\nfunction CatalogDetail:detailCache"))))
setfenv(detail_chunk, env)
detail_chunk()
function catalog:supportedFiles(detail) return detail.files or {} end
assert(catalog:detailReadPath({ id = 1 }) == nil, "cached book fallback cannot resume a missing file")
modes[path] = "file"
assert(catalog:detailReadPath({ id = 1 }) == path, "legacy matching paths still work when present")

env.ON_DEVICE_MAX_IDS = 200
env._ = function(text) return text end
env.UIManager = { show = function() end }
env.InfoMessage = { new = function(_, value) return value end }
env.Toast = { show = function() end }
local device_chunk = assert(loadstring(assert(source:match("(function BookOrbitCatalog:loadOnDevice.-)\nfunction BookOrbitCatalog:collectNotOnDeviceIds"))))
setfenv(device_chunk, env)
device_chunk()
function catalog:refreshOnDevice() end
local request
function catalog:loadBooks(params) request = params end
for id = 1, 300 do catalog.on_device[id] = path end
catalog.on_device[1] = "/path/to/library/missing.epub"
catalog.on_device[2] = "/path/to/library/directory.epub"
modes[catalog.on_device[2]] = "directory"
checks = 0
catalog:loadOnDevice()
assert(checks == 200, "availability checks remain bounded by the server ID-filter cap")
assert(request.ids:match("^3,4,") and request.ids:match(",200$"), "stale paths are excluded without widening the bounded scope")
local empty_notice = false
env.Toast.show = function() empty_notice = true end
modes[path], request = nil, nil
catalog:loadOnDevice()
assert(request == nil and empty_notice, "all missing files show an empty-device notice instead of requesting the entire library")

print("bookorbit_missing_file_test.lua: ok")
