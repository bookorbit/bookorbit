--[[--
Dashboard data for the BookOrbit catalog browser.

Fetches the dashboard body and the shelves and name lists the widget board
draws (bookorbit_catalog_board renders it), caches the body for offline
opens, and opens on the cache first so the catalog never waits on the
network.
]]

local NetworkMgr = require("ui/network/manager")
local _ = require("gettext")

local Capabilities = require("bookorbit_capabilities")
local DashboardSections = require("bookorbit_dashboard_sections")

-- Books requested per shelf. Mirrors DASHBOARD_SECTION_LIMIT on the server so
-- a shelf and the dashboard body it may be served from hold the same count.
local SHELF_PAGE_SIZE = 12

local CatalogDashboard = {}

local function isDashboardUnsupported(err)
    return err == 404 or err == 405
end

function CatalogDashboard:dashboardCache()
    local cache = self.settings.catalog_dashboard_cache
    return type(cache) == "table" and cache or nil
end

function CatalogDashboard:cacheDashboard(body)
    if type(body) ~= "table" then return end
    self:persistSetting("catalog_dashboard_cache", body)
end

function CatalogDashboard.dashboardItems()
    return {
        {
            text = _("Dashboard"),
            kind = "dashboard",
        },
    }
end

function CatalogDashboard:dashboardContext(dashboard, opts)
    opts = opts or {}
    return self.dashboardItems(), {
        kind = "dashboard",
        title = self.title,
        dashboard = dashboard,
        stale = opts.stale == true,
        unavailable = opts.unavailable == true,
        loading = opts.loading == true,
    }
end

-- A cached body is served whole. Shelves the board shows that the cache does
-- not hold draw empty until the refresh fills them.
function CatalogDashboard:cachedDashboardContext(cached, opts)
    opts = opts or {}
    opts.stale = true
    return self:dashboardContext(cached, opts)
end

-- What the catalog widget opens on, built without touching the network: the
-- cached dashboard when there is one, otherwise a placeholder the refresh
-- replaces in place. Offline the placeholder says the dashboard could not be
-- loaded, because a connection may never come.
function CatalogDashboard:initialDashboardContext()
    local cached = self:dashboardCache()
    if cached then
        return self:cachedDashboardContext(cached)
    end
    if NetworkMgr:isConnected() then
        return self:dashboardContext(nil, { stale = true, loading = true })
    end
    return self:dashboardContext(nil, { stale = true, unavailable = true })
end

-- An offline-tolerant catalog never asks for a connection on its own. An
-- explicit open is not offline-tolerant until its first refresh has asked.
function CatalogDashboard:shouldRefreshDashboardOnOpen()
    if self.prefer_cached_dashboard and not NetworkMgr:isConnected() then
        return false
    end
    return true
end

-- The refresh behind a dashboard that has just been shown. An explicit open
-- asks for a connection once, through the user's Wi-Fi policy, while the
-- cached dashboard is already on screen. Returning to the dashboard later
-- keeps the cache while offline rather than asking again.
function CatalogDashboard:refreshDashboardOnOpen()
    if self:shouldRefreshDashboardOnOpen() then
        self:loadDashboardRoot(true, { invisible = true })
    end
    self.prefer_cached_dashboard = true
end

-- One loading pill for the dashboard's requests, so it does not blink
-- between them; a background refresh shows none.
function CatalogDashboard:dashboardRoot(opts)
    if (opts and opts.invisible) or self.held_loading or not self.withLoading then
        return self:dashboardRootFetch(opts)
    end
    local items, context
    self:withLoading(_("Updating Home…"), function()
        items, context = self:dashboardRootFetch(opts)
    end)
    return items, context
end

function CatalogDashboard:dashboardRootFetch(opts)
    local function requestIsCurrent()
        return not opts or not opts.is_current or opts.is_current()
    end
    local cached = self:dashboardCache()
    if self.prefer_cached_dashboard and cached and not NetworkMgr:isConnected() then
        return self:cachedDashboardContext(cached)
    end

    local body, err = self:fetch(_("Updating Home…"), function()
        return self.client:catalogDashboard()
    end, opts)
    if body and body.continueReading then
        local function fetchSection(config)
            if not requestIsCurrent() then return nil, "cancelled" end
            -- Gathering dust: this device's never-opened books, found here and
            -- looked up by id for their titles and covers.
            if config.type == "unopened" then
                local unopened = require("bookorbit_board_data").unopened(self, os.time())
                if #unopened == 0 then return { type = config.type, books = {} } end
                local ids = {}
                for _, entry in ipairs(unopened) do table.insert(ids, entry.id) end
                local response, unopened_err = self:fetch(_("Updating Home…"), function()
                    return self.client:catalogBooks({ ids = table.concat(ids, ","), sort = "title", page = 1, size = #ids })
                end, opts)
                if unopened_err or type(response) ~= "table" then return nil, unopened_err or "invalid response" end
                return { type = config.type, books = response.items or {} }
            end
            if config.type == DashboardSections.DEFAULT_TYPE then
                if type(body.discover) == "table" then
                    return { type = config.type, books = body.discover }
                end
                local response, discover_err = self:fetch(_("Updating Home…"), function()
                    return self.client:catalogDiscover()
                end, opts)
                if discover_err or type(response) ~= "table" then
                    return nil, discover_err or "invalid response"
                end
                return { type = config.type, books = response.discover or {} }
            end
            -- Sources without a catalog-books equivalent go through the server's
            -- dashboard-section endpoint. A confirmed 404/405 downgrades the
            -- capability so the picker stops offering them against this server.
            if DashboardSections.usesSectionEndpoint(config.type) then
                local known = Capabilities.cached(self.client)
                if known and not known[DashboardSections.SECTION_ENDPOINT_CAPABILITY] then
                    return { type = config.type, books = {} }
                end
                local response, section_err = self:fetch(_("Updating Home…"), function()
                    return self.client:catalogDashboardSection(config.type)
                end, opts)
                if isDashboardUnsupported(section_err) then
                    Capabilities.markUnsupported(self.client, DashboardSections.SECTION_ENDPOINT_CAPABILITY)
                    return { type = config.type, books = {} }
                end
                if section_err or type(response) ~= "table" then
                    return nil, section_err or "invalid response"
                end
                local section = type(response.section) == "table" and response.section or {}
                return { type = config.type, books = section.books or {} }
            end

            local params = { page = 1, size = SHELF_PAGE_SIZE }
            if config.type == "recently-added" then
                params.sort = "recently_added"
            elseif config.type == "in-progress" then
                params.sort = "recently_read"
                params.readStatus = "reading"
            elseif config.type == "pick-back-up" then
                params.sort = "recently_read"
                params.order = "asc"
                params.readStatus = "reading"
            elseif DashboardSections.isCatalogSelector(config.type) then
                for key, value in pairs(config.params or {}) do params[key] = value end
            else
                return nil
            end
            local response, section_err = self:fetch(_("Updating Home…"), function()
                return self.client:catalogBooks(params)
            end, opts)
            if section_err or type(response) ~= "table" then return nil, section_err or "invalid response" end
            return { type = config.type, books = response.items or {} }
        end

        -- The board asks only for the shelves and names its pages show. A
        -- source that failed is left empty rather than failing the dashboard.
        local sources, names = {}, {}
        if self.boardSources then sources, names = self:boardSources() end
        body.boardShelves = {}
        for key, props in pairs(sources) do
            if not requestIsCurrent() then return nil, "cancelled" end
            if key == "in-progress" then
                body.boardShelves[key] = body.continueReading
            elseif key == "finished" then
                body.boardShelves[key] = body.finishedThisYear or {}
            else
                local section, section_err = fetchSection({ type = props.source, params = props.params })
                if section_err == "cancelled" then return nil, section_err end
                body.boardShelves[key] = section_err and {} or (section and section.books or {})
            end
        end
        body.boardNames = {}
        local NAME_SECTIONS = { collections = "collections", scopes = "smart-scopes" }
        for key in pairs(names) do
            if not requestIsCurrent() then return nil, "cancelled" end
            local response = self:fetch(_("Updating Home…"), function()
                return self.client:catalogSection(NAME_SECTIONS[key], { page = 1, size = 4 })
            end, opts)
            local list = {}
            for _, entry in ipairs(type(response) == "table" and response.items or {}) do
                if type(entry.title) == "string" then table.insert(list, entry.title) end
            end
            body.boardNames[key] = list
        end
        self:cacheDashboard(body)
        return self:dashboardContext(body)
    end

    if isDashboardUnsupported(err) then
        if requestIsCurrent() then
            require("bookorbit_toast").show(_("Home needs a newer BookOrbit server. Showing the catalog instead."), { icon = "info", timeout = 4 })
        end
        return self:rootItems(), { kind = "root", title = self.title }
    end

    if cached then
        return self:cachedDashboardContext(cached)
    end

    if err ~= "cancelled" and requestIsCurrent() then
        self:showServerError(err)
    end
    return self:dashboardContext(nil, { stale = true, unavailable = true })
end

function CatalogDashboard:loadDashboardRoot(replace, opts)
    self.dashboard_request_generation = (self.dashboard_request_generation or 0) + 1
    local request_generation = self.dashboard_request_generation
    local expected_context = self.current_context
    local request_opts = {}
    for key, value in pairs(opts or {}) do request_opts[key] = value end
    request_opts.is_current = function()
        return not self.catalog_closed
            and request_generation == self.dashboard_request_generation
            and self.current_context == expected_context
    end
    self:runConnected(function()
        -- The screen said the dashboard could not be loaded while this waited
        -- for a connection, so the fetch shows that it is now loading.
        if expected_context and expected_context.unavailable then
            request_opts.invisible = nil
        end
        local items, context = self:dashboardRoot(request_opts)
        if self.catalog_closed or request_generation ~= self.dashboard_request_generation
                or self.current_context ~= expected_context then
            return
        end
        -- A refresh keeps the board on the page the reader was looking at.
        if context and expected_context and expected_context.board_page then
            context.board_page = expected_context.board_page
        end
        self:switchTo(context.title or self.title, items, context, not replace)
    end)
end

-- Every book the board can draw, used for thumbnail prefetching and
-- cover-cache eviction.
function CatalogDashboard.dashboardBooks(dashboard)
    dashboard = dashboard or {}
    local books = {}
    local seen = {}
    local function add(book)
        if type(book) == "table" and book.id ~= nil and not seen[book.id] then
            seen[book.id] = true
            table.insert(books, book)
        end
    end
    for _, book in ipairs(dashboard.continueReading or {}) do add(book) end
    for _, list in pairs(type(dashboard.boardShelves) == "table" and dashboard.boardShelves or {}) do
        for _, book in ipairs(list) do add(book) end
    end
    for _, book in ipairs(dashboard.discover or {}) do add(book) end
    if type(dashboard.yearAgo) == "table" then add(dashboard.yearAgo.book) end
    return books
end

function CatalogDashboard.install(Catalog)
    for name, fn in pairs(CatalogDashboard) do
        if name ~= "install" then
            Catalog[name] = fn
        end
    end
end

return CatalogDashboard
