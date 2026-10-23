-- Proves the catalog opens on local data only: constructing the dashboard
-- context issues no request, and the server refresh is a separate step the
-- widget starts once it is interactive.

local connected = true

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

local function widgetClass()
    return {
        new = function(_, opts)
            opts = opts or {}
            if not opts.getSize then
                function opts:getSize()
                    return { w = 100, h = 20 }
                end
            end
            return opts
        end,
    }
end

package.loaded["ffi/blitbuffer"] = { COLOR_DARK_GRAY = 1, COLOR_LIGHT_GRAY = 2 }
package.loaded["ui/widget/button"] = widgetClass()
package.loaded["ui/widget/container/centercontainer"] = widgetClass()
package.loaded["ui/font"] = {
    getFace = function()
        return {}
    end,
}
package.loaded["ui/geometry"] = widgetClass()
package.loaded["ui/widget/horizontalgroup"] = widgetClass()
package.loaded["ui/widget/horizontalspan"] = widgetClass()
package.loaded["ui/widget/infomessage"] = widgetClass()
package.loaded["ui/widget/linewidget"] = widgetClass()
package.loaded["ui/network/manager"] = {
    isConnected = function()
        return connected
    end,
}
package.loaded["device"] = {
    screen = {
        scaleBySize = function(_, value)
            return value
        end,
    },
}
package.loaded["ui/size"] = {
    line = { thin = 1 },
    padding = { large = 8 },
    span = { horizontal_default = 4, vertical_default = 4 },
}
package.loaded["ui/widget/textboxwidget"] = widgetClass()
package.loaded["ui/widget/textwidget"] = widgetClass()
package.loaded["ui/uimanager"] = {
    show = function() end,
}
package.loaded["ui/widget/verticalgroup"] = widgetClass()
package.loaded["ui/widget/verticalspan"] = widgetClass()
package.loaded["bookorbit_stats_reader"] = {}
package.loaded["bookorbit_catalog_widgets"] = {}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogDashboard = require("bookorbit_catalog_dashboard")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local requests = 0
local last_fetch_opts
local cached_dashboard = {
    continueReading = { { id = 1, title = "Annihilation" } },
    discover = { { id = 2, title = "Authority" } },
}

local function newCatalog(opts)
    opts = opts or {}
    local catalog = {
        title = "BookOrbit",
        settings = { catalog_dashboard_cache = opts.cache },
        prefer_cached_dashboard = opts.prefer_cached_dashboard == true,
        client = {
            catalogDashboard = function()
                requests = requests + 1
                return { continueReading = {}, discover = {} }
            end,
        },
    }
    for name, fn in pairs(CatalogDashboard) do
        if name ~= "install" then catalog[name] = fn end
    end
    function catalog:persistSetting(key, value)
        self.settings[key] = value
    end
    function catalog:fetch(_, fn, fetch_opts)
        last_fetch_opts = fetch_opts
        return fn()
    end
    return catalog
end

-- Opening with a cached dashboard renders it immediately and asks the server
-- for nothing during construction.
requests = 0
local catalog = newCatalog{ cache = cached_dashboard }
local items, context = catalog:initialDashboardContext()
assertEqual(requests, 0, "construction issues no request")
assertEqual(#items, 1, "construction produces the dashboard item")
assertEqual(context.kind, "dashboard", "construction produces a dashboard context")
assertEqual(context.dashboard, cached_dashboard, "cached dashboard is shown right away")
assertEqual(context.stale, true, "cached dashboard is marked stale")
assertEqual(context.loading, false, "cached dashboard is not a placeholder")
assertEqual(catalog:shouldRefreshDashboardOnOpen(), true, "a connected open still refreshes")

-- The refresh is a separate step, and only it talks to the server.
local _, refreshed = catalog:dashboardRoot()
assertEqual(requests, 1, "the refresh issues exactly one request")
assertEqual(refreshed.stale, false, "a successful refresh is not stale")
assertEqual(catalog.settings.catalog_dashboard_cache ~= nil, true, "the refresh updates the cache")

-- With no cache the widget opens on a placeholder that the pending refresh
-- replaces in place.
requests = 0
catalog = newCatalog{}
local _, placeholder = catalog:initialDashboardContext()
assertEqual(requests, 0, "placeholder construction issues no request")
assertEqual(placeholder.dashboard, nil, "placeholder carries no dashboard data")
assertEqual(placeholder.loading, true, "placeholder reports that a refresh is coming")
assertEqual(placeholder.unavailable, false, "a pending refresh is not an error state")

-- An offline-tolerant open while disconnected neither requests nor asks the
-- user to connect; it settles on what it can show.
connected = false
requests = 0
catalog = newCatalog{ prefer_cached_dashboard = true }
local _, offline = catalog:initialDashboardContext()
assertEqual(requests, 0, "a disconnected open issues no request")
assertEqual(catalog:shouldRefreshDashboardOnOpen(), false, "a disconnected offline-tolerant open does not refresh")
assertEqual(offline.loading, false, "no refresh is pending, so nothing is loading")
assertEqual(offline.unavailable, true, "a disconnected open with no cache reports unavailable")

catalog = newCatalog{ prefer_cached_dashboard = true, cache = cached_dashboard }
local _, offline_cached = catalog:initialDashboardContext()
assertEqual(offline_cached.dashboard, cached_dashboard, "a disconnected open still shows the cache")
assertEqual(catalog:shouldRefreshDashboardOnOpen(), false, "a cached disconnected open does not refresh")

-- An explicit browse always refreshes, connected or not; the connected gate
-- around loadDashboardRoot decides when the request actually runs.
catalog = newCatalog{}
assertEqual(catalog:shouldRefreshDashboardOnOpen(), true, "an explicit browse always refreshes")
connected = true

-- Automatic refreshes request an invisible subprocess boundary and discard a
-- result if navigation changed the context while the request was pending.
catalog = newCatalog{ cache = cached_dashboard }
local _, initial_context = catalog:initialDashboardContext()
catalog.current_context = initial_context
local pending
function catalog:runConnected(fn)
    pending = fn
end
local switches = 0
function catalog:switchTo()
    switches = switches + 1
end
catalog:loadDashboardRoot(true, { invisible = true })
local navigated_context = { kind = "books" }
catalog.current_context = navigated_context
pending()
assertEqual(last_fetch_opts.invisible, true, "automatic dashboard refresh is non-modal")
assertEqual(switches, 0, "stale dashboard response cannot replace a navigated view")
assertEqual(catalog.current_context, navigated_context, "navigation context remains current")

-- An explicit open while offline shows the cache at once and asks for a
-- connection a single time, through the user's Wi-Fi policy. Returning to the
-- dashboard while still offline keeps the cache rather than asking again.
local function openedCatalog(opts)
    local opened = newCatalog(opts)
    local _, initial = opened:initialDashboardContext()
    opened.current_context = initial
    opened.connection_requests = {}
    function opened:runConnected(fn)
        table.insert(self.connection_requests, fn)
    end
    function opened:switchTo(_, _, next_context)
        self.current_context = next_context
    end
    return opened
end

connected = false
catalog = openedCatalog{ cache = cached_dashboard }
assertEqual(catalog.current_context.dashboard, cached_dashboard, "an offline explicit open shows the cache at once")
catalog:refreshDashboardOnOpen()
assertEqual(#catalog.connection_requests, 1, "an offline explicit open asks for a connection")
catalog:refreshDashboardOnOpen()
assertEqual(#catalog.connection_requests, 1, "returning to the dashboard offline does not ask again")

-- The connection arrives: the cached dashboard is refreshed in place, quietly.
connected = true
requests = 0
catalog.connection_requests[1]()
assertEqual(requests, 1, "the refresh runs once the connection arrives")
assertEqual(last_fetch_opts.invisible, true, "a refresh behind the cached dashboard stays non-modal")
assertEqual(catalog.current_context.stale, false, "the cached dashboard is replaced by fresh data")
catalog:refreshDashboardOnOpen()
assertEqual(#catalog.connection_requests, 2, "returning to the dashboard online still refreshes")

-- With no cache an offline explicit open says the dashboard could not be
-- loaded rather than promising a load that may never come, and still asks.
connected = false
catalog = openedCatalog{}
assertEqual(catalog.current_context.unavailable, true, "an offline open with no cache reports unavailable")
assertEqual(catalog.current_context.loading, false, "an offline open with no cache does not claim to be loading")
catalog:refreshDashboardOnOpen()
assertEqual(#catalog.connection_requests, 1, "an offline open with no cache still asks for a connection")
connected = true
catalog.connection_requests[1]()
assertEqual(last_fetch_opts.invisible, nil, "once connected, the fetch shows that the dashboard is loading")
assertEqual(catalog.current_context.unavailable, false, "the unavailable placeholder is replaced")

-- The auto-open never asks for a connection, offline or on later returns.
connected = false
catalog = openedCatalog{ prefer_cached_dashboard = true, cache = cached_dashboard }
catalog:refreshDashboardOnOpen()
catalog:refreshDashboardOnOpen()
assertEqual(#catalog.connection_requests, 0, "an offline auto-open never asks for a connection")
connected = true

-- Going home from deep in the catalog (the Dashboard button, hold Return)
-- switches to the cached dashboard at once instead of waiting on a connection.
-- bookorbit_catalog.lua cannot be loaded outside KOReader, so the method is
-- lifted out and run against the real dashboard methods.
local catalog_source = assert(io.open("koreader-plugin/bookorbit.koplugin/bookorbit_catalog.lua", "rb"))
local go_dashboard_source = assert(catalog_source:read("*a"):match("\n(function BookOrbitCatalog:goDashboard%(.-\nend)\n"),
    "goDashboard is defined in bookorbit_catalog.lua")
catalog_source:close()
local next_ticks = {}
local go_dashboard_env = {
    BookOrbitCatalog = {},
    UIManager = {
        nextTick = function(_, fn)
            table.insert(next_ticks, fn)
        end,
    },
}
local go_dashboard_chunk = assert(loadstring(go_dashboard_source, "goDashboard"))
setfenv(go_dashboard_chunk, go_dashboard_env)
go_dashboard_chunk()

connected = false
catalog = openedCatalog{ cache = cached_dashboard }
catalog:refreshDashboardOnOpen()
local detail_context = { kind = "detail" }
catalog.current_context = detail_context
catalog.stack = { { context = catalog.current_context } }
catalog.goDashboard = go_dashboard_env.BookOrbitCatalog.goDashboard
catalog.updateReturnPath = function() end
catalog:goDashboard()
assertEqual(catalog.current_context.kind, "dashboard", "going home offline shows the dashboard at once")
assertEqual(catalog.current_context.dashboard, cached_dashboard, "going home offline shows the cached dashboard")
assertEqual(#catalog.stack, 0, "going home clears the navigation stack")
assertEqual(#next_ticks, 1, "the refresh is queued behind the redraw")
next_ticks[1]()
assertEqual(#catalog.connection_requests, 1, "going home offline does not ask for a connection again")

print("bookorbit_catalog_dashboard_startup_test.lua: ok")
