--[[--
The list pages' controller: All books and every book list, Authors, Series,
Shelves (libraries, collections and scopes), a series, an author, and search.

A list fetches exactly one screen of entries (the page size comes from the
layout, so a server page is a screen), keeps List or Grid per kind of list,
and runs every control on the page: the toolbar's sort, filter and library
buttons open one Sort and filter sheet; the pager's middle opens Jump; the
thumb index jumps by letter. New query parameters are sent only to servers
advertising catalogListsV2, so an older server keeps serving the same
pages it always did.
]]

local Device = require("device")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local datetime = require("datetime")
local logger = require("logger")
local T = require("ffi/util").template
local _ = require("gettext")

local BoardData = require("bookorbit_board_data")
local BoardMetrics = require("bookorbit_board_metrics")
local Capabilities = require("bookorbit_capabilities")
local CatalogUtil = require("bookorbit_catalog_util")
local ListCache = require("bookorbit_list_cache")
local ListData = require("bookorbit_list_data")
local ListPages = require("bookorbit_list_pages")
local ListView = require("bookorbit_list_view")

local Screen = Device.screen
local cloneParams = CatalogUtil.cloneParams

local CatalogLists = {}

CatalogLists.CAPABILITY = "catalogListsV2"
local DUMP_DIR = os.getenv("BO_LIST_DUMP")

local SECTION_PAGED = { authors = true, series = true }
local SHELF_SECTIONS = { libraries = true, collections = true, ["smart-scopes"] = true, shelves = true }

-- ---------------------------------------------------------------- kinds
-- Which page a context is.
function CatalogLists:listKind(context)
    context = context or self.current_context or {}
    if context.kind == "search" then return "search" end
    if context.kind == "section" then
        if context.section == "authors" then return "authors" end
        if context.section == "series" then return "series" end
        if SHELF_SECTIONS[context.section] then return "shelves" end
        return nil
    end
    if context.kind == "books" then
        local params = context.params or {}
        if params.seriesId or params.series then return "seriespage" end
        if params.author then return "authorpage" end
        if params.readStatus == "reading" and params.sort == "recently_read" then return "reading" end
        return "books"
    end
    return nil
end

function CatalogLists:listMode()
    return self:listKind() ~= nil
end

function CatalogLists:listsSupported()
    local known = Capabilities.cached(self.client)
    return known ~= nil and known[CatalogLists.CAPABILITY] == true
end

-- Learns what the server supports, once per session, inside a connected job
-- (the version request runs off the UI thread like every fetch). Unknown on a
-- transient failure, so a later list asks again.
function CatalogLists:listEnsureCapabilities()
    if Capabilities.cached(self.client) then return end
    local body, err = self:fetch(nil, function() return self.client:getPluginVersion() end, { invisible = true })
    if body then
        Capabilities.remember(self.client, body)
    elseif type(err) == "number" and err >= 400 and err < 500 then
        Capabilities.remember(self.client, {})
    end
end

-- List or Grid, remembered per kind of list. All books keeps the old
-- mosaic/list choice the first time.
local DEFAULT_VIEW = { books = nil, reading = "list", authors = "list", series = "list", seriespage = "list", authorpage = "grid" }

function CatalogLists:listView(kind)
    kind = kind or self:listKind()
    local views = self.settings.catalog_list_views or {}
    if views[kind] == "list" or views[kind] == "grid" then return views[kind] end
    if kind == "books" then return self.view_mode == "list" and "list" or "grid" end
    return DEFAULT_VIEW[kind] or "list"
end

function CatalogLists:listSetView(view)
    local kind = self:listKind()
    if not kind or (view ~= "list" and view ~= "grid") then return end
    if self:listView(kind) == view then return end
    local views = self.settings.catalog_list_views or {}
    views[kind] = view
    self:persistSetting("catalog_list_views", views)
    if kind == "books" then
        self.view_mode = view == "grid" and "mosaic" or "list"
        self:persistSetting("catalog_view_mode", self.view_mode)
    end
    -- The first entry on screen stays first under the new page size.
    self:listReload({ page_from_index = self:listStart(self.current_context) })
end

-- Screen size the page is drawn in.
function CatalogLists:listScreen()
    return Screen:getWidth(), Screen:getHeight()
end

-- Whether a list shows the A-Z thumb index: alphabetical, with buckets.
function CatalogLists:listAlphabetical(kind, params)
    params = params or {}
    if kind == "books" then return (params.sort or "title") == "title" or params.sort == "author" end
    if kind == "authors" or kind == "series" then return (params.sort or "name") ~= "books" end
    return false
end

-- Entries per screen for a list kind, before it is fetched.
function CatalogLists:listCapacity(kind, view, params, opts)
    opts = opts or {}
    local sw, sh = self:listScreen()
    local rail = self:listAlphabetical(kind, params) and self:listsSupported()
    if kind == "reading" then rail = false end
    -- Offline the band takes the toolbar's place.
    return ListPages.capacity(sw, sh, { toolbar = not opts.offline, offline = opts.offline, rail = rail, view = view, kind = kind })
end

-- ---------------------------------------------------------- saved pages
local function cacheAccount(self)
    local client = self.client or {}
    return tostring(client.server_url) .. "|" .. tostring(client.username)
end

function CatalogLists:listSavePage(query, body)
    local ok, err = pcall(ListCache.put, ListCache.key(cacheAccount(self), query), body)
    if not ok then logger.warn("BookOrbit: saving a list page failed", err) end
end

-- The saved page for a request the server did not answer. A status code means
-- it did answer (a login or server error), which a saved page must not hide.
function CatalogLists:listSavedPage(query, err)
    if type(err) == "number" then return nil end
    local ok, saved = pcall(ListCache.get, ListCache.key(cacheAccount(self), query))
    if ok and saved then logger.warn("BookOrbit: server unreachable, showing the saved list page", err) end
    return ok and saved or nil
end

-- A series is drawn as one local list, while the API deliberately caps each
-- response. Keep requesting bounded server pages before the local paginator
-- takes over.
function CatalogLists:listFetchCompleteSeries(query, first_body, title)
    if not (query.seriesId or query.series) then return first_body end

    local items, seen = {}, {}
    local function append(body)
        local added = 0
        for _i, book in ipairs(body.items or {}) do
            local key = book.id ~= nil and tostring(book.id) or nil
            if not key or not seen[key] then
                if key then seen[key] = true end
                table.insert(items, book)
                added = added + 1
            end
        end
        return added
    end

    append(first_body)
    local body = first_body
    local total = tonumber(body.total)
    local page = tonumber(body.page) or tonumber(query.page) or 1
    local offline_saved_at
    local has_next = body.hasNext == true or (total and #items < total)

    while has_next do
        page = page + 1
        local page_query = cloneParams(query)
        page_query.page = page
        page_query.offset = nil
        local next_body, err = self:fetch(title and T(_("Opening %1…"), title) or _("Opening books…"), function()
            return self.client:catalogBooks(page_query)
        end)
        if not next_body then
            local saved = self:listSavedPage(page_query, err)
            if not saved then return nil, err end
            next_body = saved.body
            local saved_at = tonumber(saved.saved_at) or 0
            offline_saved_at = offline_saved_at and math.min(offline_saved_at, saved_at) or saved_at
        else
            self:listSavePage(page_query, next_body)
        end

        if append(next_body) == 0 then return nil, "incomplete series response" end
        body = next_body
        total = tonumber(body.total) or total
        has_next = body.hasNext == true or (total and #items < total)
    end

    local complete = {}
    for key, value in pairs(first_body) do complete[key] = value end
    complete.items = items
    complete.total = math.max(total or 0, #items)
    complete.page = 1
    complete.hasNext = false
    complete.hasPrevious = false
    complete.nextUrl = nil
    complete.previousUrl = nil
    return complete, nil, offline_saved_at
end

-- The server page size for a book list. A series or an author page draws
-- all its books (local pages when there are more than fit).
function CatalogLists:listBookPageSize(params)
    local kind = self:listKind({ kind = "books", params = params })
    if kind == "seriespage" or kind == "authorpage" then return 100 end
    return math.min(100, self:listCapacity(kind, self:listView(kind), params))
end

-- --------------------------------------------------------------- loading
-- Book lists: extra request fields for newer servers.
function CatalogLists:listDecorateBookQuery(query)
    if not self:listsSupported() then return query end
    local kind = self:listKind({ kind = "books", params = query })
    if kind == "books" and ((query.sort or "title") == "title" or query.sort == "author") then query.buckets = 1 end
    return query
end

-- Called with the books page body: what the list pages need beyond items.
function CatalogLists:listAdoptBookBody(context, body)
    context.buckets = body.buckets
    context.author_summary = body.authorSummary
    context.series_summary = body.seriesSummary
    context.page_size = body.size or (context.params and context.params.size)
    context.local_page = 1
end

-- A section (authors, series): one screen per request on newer servers.
function CatalogLists:listSectionParams(section, opts)
    local params = {}
    if opts.offset and self:listOffsets() then params.offset = opts.offset
    elseif opts.page and opts.page > 1 then params.page = opts.page end
    if opts.q and opts.q ~= "" then params.q = opts.q end
    if self:listsSupported() then
        local kind = section
        local sort = opts.sort or "name"
        params.size = self:listCapacity(kind, self:listView(kind), { sort = sort })
        if sort ~= "name" then params.sort = sort end
        if opts.filter then params.filter = opts.filter end
    end
    return params
end

-- Libraries, collections and scopes, on one page.
-- opts.dashboard_source_index: picking one for a shelf on Home.
function CatalogLists:loadShelves(opts)
    opts = opts or {}
    self:runConnected(function()
        local bodies = {}
        for _i, section in ipairs({ "libraries", "collections", "smart-scopes" }) do
            local body, err = self:fetch(_("Opening shelves…"), function() return self.client:catalogSection(section) end)
            if not body then
                if err ~= "cancelled" then self:showRetry(err, function() self:loadShelves(opts) end) end
                return
            end
            bodies[section] = body.items or {}
        end
        local item_table = {}
        for _i, section in ipairs({ "libraries", "collections", "smart-scopes" }) do
            for _j, entry in ipairs(bodies[section]) do
                table.insert(item_table, { text = entry.title, kind = "books", params = self:paramsForEntry(section, entry), entry = entry })
            end
        end
        self:switchTo(_("Shelves"), item_table, {
            kind = "section",
            section = "shelves",
            title = _("Shelves"),
            shelves = bodies,
            page = 1,
            dashboard_source_index = opts.dashboard_source_index,
        }, not opts.replace)
    end)
end

-- Global search: authors, series and books for one query.
function CatalogLists:listSearch(q, opts)
    opts = opts or {}
    q = require("util").trim(q or "")
    if q == "" then return end
    self:recordRecentSearch(q)
    self:runConnected(function() self:withLoading(T(_("Searching for “%1”…"), q), function()
        self:listEnsureCapabilities()
        local authors, series, books
        local a_body, err = self:fetch(_("Searching..."), function() return self.client:catalogSection("authors", { q = q, size = self:listsSupported() and 12 or nil }) end)
        if not a_body then
            if err ~= "cancelled" then self:showRetry(err, function() self:listSearch(q, opts) end) end
            return
        end
        local s_body, s_err = self:fetch(_("Searching..."), function() return self.client:catalogSection("series", { q = q, size = self:listsSupported() and 12 or nil }) end)
        if not s_body then
            if s_err ~= "cancelled" then self:showRetry(s_err, function() self:listSearch(q, opts) end) end
            return
        end
        local b_body, b_err = self:fetch(_("Searching..."), function() return self.client:catalogBooks({ q = q, sort = "title", page = 1, size = 48 }) end)
        if not b_body then
            if b_err ~= "cancelled" then self:showRetry(b_err, function() self:listSearch(q, opts) end) end
            return
        end
        authors = a_body.items or {}
        series = s_body.items or {}
        books = b_body.items or {}
        self:switchTo(T(_("Search: %1"), q), (function()
            local t = {}
            for _i, b in ipairs(books) do table.insert(t, { kind = "book", book_id = b.id, book = b, text = b.title }) end
            return t
        end)(), {
            kind = "search",
            title = _("Search"),
            query = q,
            scope = opts.scope or "all",
            results = { authors = authors, series = series, books = books, books_total = b_body.total or #books },
            books = books,
            page = 1,
        }, not opts.replace)
    end) end)
end

-- Reloads the current list with changed params (sort, filter, view, page).
function CatalogLists:listReload(opts)
    opts = opts or {}
    local context = self.current_context or {}
    local kind = self:listKind(context)
    if kind == "books" or kind == "reading" or kind == "seriespage" or kind == "authorpage" then
        local params = cloneParams(context.params or {})
        if opts.params then for k, v in pairs(opts.params) do params[k] = v end end
        if opts.clear then for _i, k in ipairs(opts.clear) do params[k] = nil end end
        params.size = nil
        params.offset = nil
        if opts.page_from_index then
            params.page = ListData.pageOf(opts.page_from_index, self:listBookPageSize(params))
            if self:listOffsets() and (kind == "books" or kind == "reading") then params.offset = opts.page_from_index end
        else
            params.page = opts.page or 1
        end
        self:loadBooks(params, context.title or _("Books"), false)
    elseif kind == "authors" or kind == "series" then
        local page = opts.page or 1
        local offset
        if opts.page_from_index then
            page = ListData.pageOf(opts.page_from_index, self:listCapacity(kind, self:listView(kind), { sort = context.sort }))
            if self:listOffsets() then offset = opts.page_from_index end
        end
        self:loadSection(context.section, {
            page = page, offset = offset, q = context.q, replace = true,
            sort = opts.sort or context.sort, filter = opts.filter ~= nil and (opts.filter or nil) or context.filter,
            dashboard_source_index = context.dashboard_source_index,
        })
    elseif kind == "shelves" then
        self:loadShelves({ replace = true })
    elseif kind == "search" then
        self:listSearch(context.query, { replace = true, scope = context.scope })
    end
end

-- ----------------------------------------------------------------- paging
-- A server that lists by catalogListsV2 starts a page at any entry, so a
-- reader keeps the same first entry when the page size changes.
function CatalogLists:listOffsets()
    return self:listsSupported()
end

-- Where the screen's first entry sits in the whole list (0-based).
function CatalogLists:listStart(context)
    context = context or self.current_context or {}
    if context.offset then return context.offset end
    return ((context.page or 1) - 1) * (context.page_size or 0)
end

local windowPaging = ListData.windowPaging

-- Pages of the current list: { page, pages, has_prev, has_next }, plus start
-- and per for a list the server pages.
function CatalogLists:listPaging(context)
    context = context or self.current_context or {}
    local kind = self:listKind(context)
    if kind == "authors" or kind == "series" then
        if not context.page_size then
            -- An older server pages by 60; the screen pages within that.
            local per = self:listCapacity(kind, self:listView(kind), { sort = context.sort })
            local offset = context.local_offset or 0
            local all = #(context.entries or {})
            return { page = math.floor(offset / per) + 1, pages = nil, local_per = per,
                has_prev = offset > 0 or (context.page or 1) > 1, has_next = offset + per < all or context.has_next == true }
        end
        return windowPaging(self:listStart(context), context.page_size, context.total, context.has_next)
    end
    if kind == "seriespage" or kind == "authorpage" then
        return { page = context.local_page or 1, pages = context.local_pages or 1 }
    end
    if kind == "search" or kind == "shelves" then return { page = 1, pages = 1 } end
    if (kind == "books" or kind == "reading") and context.page_size and context.total then
        return windowPaging(self:listStart(context), context.page_size, context.total)
    end
    return { page = context.page or 1, pages = context.page_count or 1 }
end

-- The first entry of display page `page` around this screen, or nil on a
-- server that pages by page number only.
function CatalogLists:listStartOfPage(p, page)
    if not p.start or not self:listOffsets() then return nil end
    return math.max(0, p.start + (page - p.page) * p.per)
end

function CatalogLists:listGoPage(page)
    local context = self.current_context or {}
    local kind = self:listKind(context)
    local p = self:listPaging(context)
    if page < 1 or (p.pages and page > p.pages) then return true end
    if page == p.page then return true end
    if kind == "seriespage" or kind == "authorpage" then
        context.local_page = page
        self:updateItems(nil, true)
        return true
    end
    local start = self:listStartOfPage(p, page)
    if kind == "authors" or kind == "series" then
        if not p.pages and page > p.page and not p.has_next then return true end
        self:reloadSection(context.section, { page = start and (math.floor(start / p.per) + 1) or page, offset = start, sort = context.sort, filter = context.filter })
        return true
    end
    if kind == "books" or kind == "reading" then
        local params = cloneParams(context.params or {})
        params.page = start and (math.floor(start / p.per) + 1) or page
        params.offset = start
        self:loadBooks(params, context.title, false)
    end
    return true
end

-- Opens the list at an entry: at the top of the screen when the server pages
-- by offset, else on the page that holds it.
function CatalogLists:listGoToIndex(index)
    local context = self.current_context or {}
    local kind = self:listKind(context)
    if self:listOffsets() and context.page_size and (kind == "books" or kind == "reading" or kind == "authors" or kind == "series") then
        if index == self:listStart(context) then return self:updateItems(nil, true) end
        return self:listReload({ page_from_index = index })
    end
    return self:listGoPage(ListData.pageOf(index, context.page_size or 1))
end

function CatalogLists:listPage(delta)
    local context = self.current_context or {}
    local kind = self:listKind(context)
    local p = self:listPaging()
    if (kind == "authors" or kind == "series") and not context.page_size then
        local offset = (context.local_offset or 0) + delta * p.local_per
        local all = #(context.entries or {})
        if offset >= 0 and offset < all then
            context.local_offset = offset
            return self:updateItems(nil, true)
        end
        if offset >= all and context.has_next then
            return self:reloadSection(context.section, { page = (context.page or 1) + 1 })
        end
        if offset < 0 and (context.page or 1) > 1 then
            return self:reloadSection(context.section, { page = context.page - 1 })
        end
        return true
    end
    return self:listGoPage((p.page or 1) + delta)
end

-- The entries this screen shows: the server page, or a screen's slice of an
-- older server's 60.
function CatalogLists:listSectionEntries(context)
    local all = context.entries or {}
    local per = self:listCapacity(self:listKind(context), self:listView(self:listKind(context)), { sort = context.sort })
    -- Never more than a screen, whatever size the server sent.
    if context.page_size then
        if #all <= per then return all end
        local out = {}
        for i = 1, per do out[i] = all[i] end
        return out
    end
    local offset = context.local_offset or 0
    local out = {}
    for i = offset + 1, math.min(#all, offset + per) do table.insert(out, all[i]) end
    return out
end

-- The page that holds a letter, from the list's buckets.
function CatalogLists:listJumpLetter(letter)
    local context = self.current_context or {}
    local index
    for _i, b in ipairs(context.buckets or {}) do
        if b.key == letter then index = b.index; break end
    end
    if not index then return end
    return self:listGoToIndex(index)
end

-- ----------------------------------------------------------------- sheets
local SORT_IDS = { "title", "author", "series", "recently_added", "recently_read" }
local SHOW_IDS = { false, "unread", "reading", "finished" }

function CatalogLists:listSheetState(context)
    context = context or self.current_context or {}
    local sheet = context.list_sheet
    if not sheet then return nil end
    return sheet
end

function CatalogLists:listOpenSheet(kind, focus)
    local context = self.current_context or {}
    local list_kind = self:listKind(context)
    if kind == "sort" then
        local staged = {}
        if list_kind == "books" or list_kind == "reading" then
            local params = context.params or {}
            staged = {
                sort = params.sort or "title",
                order = self:effectiveOrder(params),
                readStatus = params.readStatus,
                libraryId = params.libraryId,
                format = params.format,
                on_device = context.on_device_filter == true,
            }
        else
            staged = { sort = context.sort or "name", filter = context.filter }
        end
        context.list_sheet = { kind = "sort", staged = staged, focus = focus }
    elseif kind == "jump" then
        local p = self:listPaging(context)
        context.list_sheet = { kind = "jump", page = p.page, pages = p.pages or p.page }
    end
    self:updateItems(nil, true)
end

function CatalogLists:listCloseSheet()
    local context = self.current_context or {}
    if not context.list_sheet then return false end
    context.list_sheet = nil
    self:updateItems(nil, true)
    return true
end

-- Applies the staged sort and filter: one reload for all of them.
function CatalogLists:listApplySheet()
    local context = self.current_context or {}
    local sheet = context.list_sheet
    context.list_sheet = nil
    if not sheet or sheet.kind ~= "sort" then return self:updateItems(nil, true) end
    local s = sheet.staged
    local kind = self:listKind(context)
    if kind == "books" or kind == "reading" then
        local params = cloneParams(context.params or {})
        local changed_sort = params.sort ~= s.sort
        params.sort = s.sort
        params.order = s.order ~= (CatalogUtil.NATURAL_ORDER[s.sort] or "asc") and s.order or nil
        params.readStatus = s.readStatus or nil
        params.libraryId = s.libraryId
        params.format = s.format
        if s.on_device and not context.on_device_filter then
            local ids = {}
            for id in pairs(self.on_device or {}) do table.insert(ids, id) end
            table.sort(ids)
            local capped = {}
            for i = 1, math.min(#ids, CatalogUtil.ON_DEVICE_MAX_IDS) do capped[i] = ids[i] end
            params.ids = table.concat(capped, ",")
        elseif not s.on_device and context.on_device_filter then
            params.ids = nil
        end
        if changed_sort then
            self.default_sort = s.sort
            self:persistSetting("catalog_sort", s.sort)
        end
        params.on_device_filter = s.on_device == true or nil
        params.page = 1
        params.size = nil
        local title = context.title
        if context.on_device_filter and not s.on_device and title == _("On device") then
            title = _("Library")
        end
        self:runConnected(function()
            self:fetchBookPage(params, title, false)
            local now = self.current_context
            if now and now.kind == "books" then now.on_device_filter = s.on_device == true end
        end)
        return
    end
    if kind == "authors" or kind == "series" then
        self:reloadSection(context.section, { page = 1, sort = s.sort, filter = s.filter or false })
    end
end

function CatalogLists:listResetSheet()
    local sheet = self:listSheetState()
    if not sheet or sheet.kind ~= "sort" then return end
    local kind = self:listKind()
    if kind == "books" or kind == "reading" then
        sheet.staged = { sort = "title", order = "asc", on_device = false }
    else
        sheet.staged = { sort = "name" }
    end
    sheet.pick = nil
    self:updateItems(nil, true)
end

-- The sort sheet's model for the current list.
function CatalogLists:listSortSheetModel(sheet)
    local s = sheet.staged
    local kind = self:listKind()
    if kind == "books" or kind == "reading" then
        local sort_index = 1
        for i, id in ipairs(SORT_IDS) do if id == s.sort then sort_index = i end end
        local time_sort = CatalogUtil.SORT_KIND[s.sort] == "time"
        local natural = CatalogUtil.NATURAL_ORDER[s.sort] or "asc"
        local order_labels = time_sort and { _("Newest"), _("Oldest") } or { _("A–Z"), _("Z–A") }
        local first_order = time_sort and "desc" or "asc"
        local show_index = 1
        for i, id in ipairs(SHOW_IDS) do if (id or nil) == s.readStatus then show_index = i end end
        local library_label = _("All libraries")
        for _i, lib in ipairs(self:listLibraries()) do if tostring(lib.id) == tostring(s.libraryId) then library_label = lib.title end end
        if sheet.pick == "library" then
            local options = { { label = _("All libraries"), value = false, on = s.libraryId == nil } }
            for _i, lib in ipairs(self:listLibraries()) do table.insert(options, { label = lib.title, value = tonumber(lib.id), on = tostring(lib.id) == tostring(s.libraryId) }) end
            return { pick = true, title = _("Library"), options = options }
        elseif sheet.pick == "format" then
            local options = { { label = _("Any"), value = false, on = s.format == nil } }
            for _i, fmt in ipairs(CatalogUtil.COMMON_FORMATS) do
                if CatalogUtil.isSupportedFormat(fmt) then table.insert(options, { label = string.upper(fmt), value = fmt, on = s.format == fmt }) end
            end
            return { pick = true, title = _("Format"), options = options }
        end
        return {
            title = _("Sort and filter"),
            sorts = { labels = { _("Title"), _("Author"), _("Series"), _("Added"), _("Read") }, selected = sort_index },
            order = { labels = order_labels, selected = (s.order or natural) == first_order and 1 or 2 },
            shows = { labels = { _("All"), _("Unread"), _("Reading"), _("Finished") }, selected = show_index },
            rows = {
                { icon = "bo-device", label = _("Only books on this device"), toggle = s.on_device == true, action = { kind = "sheet-device" }, key = "device" },
                { icon = "library", label = _("Library"), value = library_label, chevron = true, action = { kind = "sheet-open-pick", pick = "library" }, key = "library" },
                { icon = "file-text", label = _("Format"), value = s.format and string.upper(s.format) or _("Any"), chevron = true, action = { kind = "sheet-open-pick", pick = "format" }, key = "format" },
                { icon = "list-checks", label = _("Select books"), chevron = true, action = { kind = "select-start" }, key = "select" },
                { icon = "download", label = _("Download..."), chevron = true, action = { kind = "download-actions" }, key = "download" },
            },
        }
    end
    local by_books = s.sort == "books"
    local name_index = (s.sort == "name_desc") and 2 or 1
    local shows = kind == "authors" and { _("Everyone"), _("Reading now"), _("Read") } or { _("All series"), _("In progress"), _("Finished") }
    local show_index = s.filter == "reading" and 2 or s.filter == "finished" and 3 or 1
    return {
        title = _("Sort and filter"),
        sorts = { labels = { _("Name"), _("Most books") }, selected = by_books and 2 or 1 },
        order = not by_books and { labels = { _("A–Z"), _("Z–A") }, selected = name_index } or nil,
        shows = { labels = shows, selected = show_index },
        rows = {},
        note = _("Saved for this list"),
    }
end

function CatalogLists:listLibraries()
    local cached = self.list_libraries
    if cached then return cached end
    local body = self.dashboardCache and self:dashboardCache() or {}
    return body.libraries or {}
end

-- -------------------------------------------------------------- actions
function CatalogLists:listRun(action, region, hold)
    local context = self.current_context or {}
    local kind = action.kind
    local sheet = context.list_sheet
    if kind == "noop" then return end
    if kind ~= "page" then self._list_keep_jump = nil end
    if hold then
        if action.book then
            return self:showBookActionSheetForEntry({ kind = "book", book_id = action.book.id, book = action.book })
        end
        return
    end
    if kind == "back" then return self:onReturn()
    elseif kind == "menu" then
        if self.show_dashboard_menu then self.show_dashboard_menu(self) end
        return
    elseif kind == "search" then
        return self:promptSearch({}, nil)
    elseif kind == "close-sheet" then
        if sheet and sheet.kind == "sort" then return self:listApplySheet() end
        return self:listCloseSheet()
    elseif kind == "sheet-done" then
        return self:listApplySheet()
    elseif kind == "sheet-reset" then
        return self:listResetSheet()
    elseif kind == "sheet-sort" and sheet then
        local lk = self:listKind()
        if lk == "books" or lk == "reading" then
            sheet.staged.sort = SORT_IDS[action.index] or "title"
            sheet.staged.order = CatalogUtil.NATURAL_ORDER[sheet.staged.sort] or "asc"
        else
            sheet.staged.sort = action.index == 2 and "books" or "name"
        end
        return self:updateItems(nil, true)
    elseif kind == "sheet-order" and sheet then
        local lk = self:listKind()
        if lk == "books" or lk == "reading" then
            local time_sort = CatalogUtil.SORT_KIND[sheet.staged.sort] == "time"
            local first = time_sort and "desc" or "asc"
            sheet.staged.order = action.index == 1 and first or (first == "asc" and "desc" or "asc")
        else
            sheet.staged.sort = action.index == 2 and "name_desc" or "name"
        end
        return self:updateItems(nil, true)
    elseif kind == "sheet-show" and sheet then
        local lk = self:listKind()
        if lk == "books" or lk == "reading" then
            sheet.staged.readStatus = SHOW_IDS[action.index] or nil
        else
            sheet.staged.filter = action.index == 2 and "reading" or action.index == 3 and "finished" or nil
        end
        return self:updateItems(nil, true)
    elseif kind == "sheet-device" and sheet then
        sheet.staged.on_device = not sheet.staged.on_device
        return self:updateItems(nil, true)
    elseif kind == "sheet-open-pick" and sheet then
        sheet.pick = action.pick
        if action.pick == "library" and not self.list_libraries then
            return self:listFetchLibraries(function() self:updateItems(nil, true) end)
        end
        return self:updateItems(nil, true)
    elseif kind == "sheet-back" and sheet then
        sheet.pick = nil
        return self:updateItems(nil, true)
    elseif kind == "sheet-pick" and sheet then
        if sheet.pick == "library" then sheet.staged.libraryId = action.value or nil
        elseif sheet.pick == "format" then sheet.staged.format = action.value or nil end
        sheet.pick = nil
        return self:updateItems(nil, true)
    elseif kind == "sort-sheet" then
        return self:listOpenSheet("sort", action.focus)
    elseif kind == "view" then
        return self:listSetView(action.view)
    elseif kind == "page" then
        if sheet and sheet.kind == "jump" then
            -- The stepper keeps Jump open on the page it lands on. A page from
            -- the server arrives later as a new list, which reopens it.
            -- A local page re-renders this same list (its sheet stays); a page
            -- from the server is a new list, picked up when it is drawn.
            self._list_keep_jump = { kind = self:listKind(context), from = context, until_t = os.time() + 30 }
            self:listPage(action.delta)
            return
        end
        return self:listPage(action.delta)
    elseif kind == "page-to" then
        context.list_sheet = nil
        if (self:listPaging().page or 1) == action.page then return self:updateItems(nil, true) end
        return self:listGoPage(action.page)
    elseif kind == "jump-sheet" then
        return self:listOpenSheet("jump")
    elseif kind == "jump-letter" then
        context.list_sheet = nil
        if not self:listOffsets() then
            local before = self:listPaging().page
            local target
            for _i, b in ipairs(context.buckets or {}) do if b.key == action.letter then target = ListData.pageOf(b.index, context.page_size or 1) end end
            if target == before then return self:updateItems(nil, true) end
        end
        return self:listJumpLetter(action.letter)
    elseif kind == "open-book" then
        if self:isBulkSelectionActive() then
            local book = action.book
            if book then return self:bulkToggleEntry({ kind = "book", book = book, book_id = book.id }) end
        end
        if context.list_offline then
            local path = self:onDeviceBookPath(action.book)
            if type(path) == "string" and path ~= "" then return self:openDownloadedFile(path) end
            require("bookorbit_toast").error(_("This book is not on this device. Connect to BookOrbit to download it."))
            return
        end
        local list = nil
        if context.kind == "search" then list = { books = context.books, label = _("Search") } end
        return self:loadBookDetail(action.book.id, list and { list = list } or nil)
    elseif kind == "reconnect" then
        return self:listReload({ page = context.page })
    elseif (kind == "open-author" or kind == "open-series" or kind == "open-shelf") and context.dashboard_source_index then
        -- Picking for a Home shelf: the row is the pick.
        local e = action.entry or action.shelf
        local section = kind == "open-author" and "authors" or kind == "open-series" and "series" or e.section
        return self:boardAddPickedShelf({ type = section, sourceName = e.title, params = self:paramsForEntry(section, e) })
    elseif kind == "open-author" then
        local e = action.entry
        return self:loadBooks({ author = e.id or e.title, sort = "series" }, e.title, true)
    elseif kind == "open-series" then
        local e = action.entry
        return self:loadBooks(self:paramsForEntry("series", e), e.title, true)
    elseif kind == "open-shelf" then
        local s = action.shelf
        return self:loadBooks(self:paramsForEntry(s.section, s), s.title, true)
    elseif kind == "select-start" then
        context.list_sheet = nil
        return self:bulkEnterSelectionMode()
    elseif kind == "select-done" then
        return self:bulkExitSelectionMode()
    elseif kind == "select-menu" then
        return self:showBulkSelectionActions()
    elseif kind == "download-actions" then
        self:listCloseSheet()
        return self:showDownloadActions()
    elseif kind == "select-all" then
        self.bulk_select_all = not self.bulk_select_all
        return self:updateItems(nil, true)
    elseif kind == "select-download" then
        if self.bulk_select_all then return self:confirmBulkAllMatching() end
        return self:confirmBulkBooks(self:bulkSelectedBooks(), _("Selected books"), { clear_selection = true })
    elseif kind == "select-mark-read" then
        return self:listMarkSelectedRead()
    elseif kind == "download-all" then
        return self:confirmBulkAllMatching()
    elseif kind == "full-bio" then
        local summary = context.author_summary or {}
        return self:showFullText(summary.name or context.title, summary.description or "")
    elseif kind == "clear-filters" then
        if context.kind == "books" then
            if context.on_device_filter and context.title == _("On device") then context.title = _("Library") end
            context.on_device_filter = nil
            return self:listReload({ clear = { "readStatus", "format", "libraryId", "ids", "on_device_filter" } })
        end
        return self:reloadSection(context.section, { page = 1, filter = false })
    elseif kind == "search-edit" then
        return self:promptSearch({}, nil, context.query)
    elseif kind == "search-clear" then
        return self:promptSearch({}, nil, "")
    elseif kind == "search-scope" then
        local scope = action.scope
        if scope == "books" then return self:runSearch({}, context.query, nil, true) end
        if scope == "authors" then return self:loadSection("authors", { q = context.query }) end
        if scope == "series" then return self:loadSection("series", { q = context.query }) end
        return
    end
end

function CatalogLists:listFetchLibraries(done)
    self:runConnected(function()
        local body = self:fetch(_("Loading libraries…"), function() return self.client:catalogSection("libraries") end)
        if body then self.list_libraries = body.items or {} end
        if done then done() end
    end)
end

-- Marks the chosen books read, one request each, then redraws.
function CatalogLists:listMarkSelectedRead()
    local books = self:bulkSelectedBooks()
    if #books == 0 then return end
    self:runConnected(function()
        local done, failed = 0, 0
        for _i, book in ipairs(books) do
            local body = self:fetch(T(_("Marking %1 of %2 read…"), done + failed + 1, #books), function()
                return self.client:catalogSetReadStatus(book.id, "read")
            end)
            if body then
                book.readStatus = "read"
                book.progressPercentage = 100
                done = done + 1
            else
                failed = failed + 1
            end
        end
        self:markStackDirty()
        self:bulkExitSelectionMode()
        if failed > 0 then
            require("bookorbit_toast").error(T(_("Marked %1 read. %2 could not be updated."), done, failed))
        else
            require("bookorbit_toast").show(T(_("Marked %1 read"), done))
        end
    end)
end

-- --------------------------------------------------------------- the page
-- The time left in a book being read on this device, from KOReader's own
-- statistics.
function CatalogLists:listMinutesLeft(book)
    if not book or ListData.stateOf(book) ~= "reading" then return nil end
    local path = self:onDeviceBookPath(book)
    if type(path) ~= "string" then return nil end
    self._list_md5 = self._list_md5 or {}
    local md5 = self._list_md5[path]
    if md5 == nil then
        local ok, util = pcall(require, "util")
        md5 = ok and util.partialMD5 and util.partialMD5(path) or false
        self._list_md5[path] = md5
    end
    if not md5 then return nil end
    local f = BoardData.forecast(book, md5, os.time())
    return f and f.minutes_left or nil
end

function CatalogLists:listPhotoBook(entry)
    local id = entry.authorId or entry.id
    if not entry.hasPhoto or type(id) ~= "number" then return nil end
    return { id = id, hasCover = true, updatedAt = "photo", author_photo = true }
end

function CatalogLists:listEnv()
    return {
        thumb = function(book)
            if not book then return nil end
            local path = self:thumbnailDisplay(book)
            return path
        end,
        photo = function(entry)
            local pb = self:listPhotoBook(entry)
            if not pb then return nil end
            local path = self:thumbnailDisplay(pb)
            return path
        end,
        on_device = function(book) return self:isOnDevice(book) end,
        minutes_left = function(book) return self:listMinutesLeft(book) end,
        offline = self.current_context and self.current_context.list_offline == true,
        now = os.time(),
    }
end

local function lettersFor(entries, letter_of)
    return ListData.lettersOf(entries, letter_of)
end

-- The model for a paged list of books, authors or series.
function CatalogLists:listModel(context, kind)
    local view = self:listView(kind)
    local sw, sh = self:listScreen()
    local params = context.params or {}
    local m = { kind = kind == "reading" and "books" or kind, view = view, screen_w = sw, screen_h = sh }
    m.offline = context.list_offline and {} or nil
    local supported = self:listsSupported()
    local present = ListData.presentLetters(context.buckets)
    local alpha
    if kind == "authors" or kind == "series" then alpha = (context.sort or "name") ~= "books"
    else alpha = self:listAlphabetical(kind, params) end
    m.rail = alpha and context.buckets ~= nil and kind ~= "reading"
    m.present = present
    local select = self:isBulkSelectionActive()
    if kind == "books" or kind == "reading" then
        m.entries = context.books or {}
        local per = self:listCapacity(kind, view, params, { offline = context.list_offline })
        if #m.entries > per then
            local out = {}
            for i = 1, per do out[i] = m.entries[i] end
            m.entries = out
        end
        m.select = select
        m.selected = function(b) return self.bulk_select_all or self:bulkIsBookSelected(b) end
        m.action = function(b) return { kind = "open-book", book = b } end
        local sort = params.sort or "title"
        if kind == "reading" or sort == "recently_read" then
            m.gutter = 52
            m.rail = false
            local now = os.time()
            -- Older servers order by when the status changed, which can disagree
            -- with lastReadAt; a group is labelled only where it first starts.
            m.first_only = true
            m.groupOf = function(b)
                local t = b.lastReadAt and datetime.stringISO8601ToSeconds and datetime.stringISO8601ToSeconds(b.lastReadAt)
                -- Never opened: these come last, under no day.
                if not t then return "" end
                local days = math.floor((BoardData.dayStart(now) - BoardData.dayStart(t)) / 86400 + 0.5)
                if days < 1 then return _("Today") end
                if days < 7 then return BoardData.shortWeekday(t) end
                return BoardData.shortMonth(t)
            end
        elseif sort == "recently_added" or sort == "recently_updated" then
            m.gutter = 52
            m.rail = false
            m.groupOf = function(b)
                local t = datetime.stringISO8601ToSeconds and datetime.stringISO8601ToSeconds(sort == "recently_added" and b.addedAt or b.updatedAt)
                return t and BoardData.shortMonth(t) or "#"
            end
        elseif sort == "author" then
            m.groupOf = function(b) return ListData.letterOf(b.authors and b.authors[1] or "") end
        elseif sort == "series" then
            m.rail = false
            m.groupOf = function(b) return ListData.letterOf(b.seriesName or b.title) end
        else
            m.groupOf = function(b) return ListData.letterOf(b.title) end
        end
    else
        m.entries = self:listSectionEntries(context)
        m.action = function(e) return { kind = kind == "authors" and "open-author" or "open-series", entry = e } end
        m.groupOf = function(e) return e.letter or ListData.letterOf(e.title) end
        if (context.sort or "name") == "books" then m.gutter = 0; m.rail = false end
    end
    m.letters = lettersFor(m.entries, m.groupOf)
    -- The first entry's group started on an earlier page when its bucket lies
    -- before this page.
    local first = m.entries[1]
    local start = self:listStart(context)
    if first and context.buckets and start > 0 then
        local g = m.groupOf(first)
        m.carried = present[g] ~= nil and present[g] < start
    end
    if #m.entries == 0 then
        m.empty = self:listEmptyModel(kind, context)
    end
    return m
end

function CatalogLists:listEmptyModel(kind, context)
    local params = context.params or {}
    local query = params.q or context.q
    if query then
        return { icon = "search", title = T(_("Nothing matches “%1”"), query), body = _("Try fewer words, or search the whole library from the header."), action = nil }
    end
    if params.readStatus or params.format or params.libraryId or context.on_device_filter or context.filter then
        return { icon = "list-filter", title = _("Nothing matches these filters"), body = _("Clear a filter to see more."), action = { label = _("Clear filters"), action = { kind = "clear-filters" } } }
    end
    if kind == "authors" then return { icon = "feather", title = _("No authors yet"), body = _("Authors appear here as books are added to your libraries.") } end
    if kind == "series" then return { icon = "layers-2", title = _("No series yet"), body = _("Series appear here as books that belong to one are added.") } end
    return { icon = "book", title = _("No books here yet"), body = _("Books you add to BookOrbit appear here.") }
end

local SORT_SHORT = {
    title = _("Title A–Z"), author = _("Author A–Z"), series = _("Series order"), recently_added = _("Recently added"),
    recently_updated = _("Recently updated"), recently_read = _("Last read"),
}

function CatalogLists:listSortLabel(params)
    local sort = params.sort or "title"
    local order = self:effectiveOrder(params)
    local label = SORT_SHORT[sort] or _("Title A–Z")
    if CatalogUtil.SORT_KIND[sort] == "alpha" and order == "desc" then
        label = sort == "title" and _("Title Z–A") or sort == "author" and _("Author Z–A") or label
    elseif CatalogUtil.SORT_KIND[sort] == "time" and order == "asc" then
        label = label .. " " .. _("(oldest)")
    end
    return label
end

function CatalogLists:listToolbar(kind, context)
    local params = context.params or {}
    if kind == "books" or kind == "reading" then
        local sort_label = self:listSortLabel(params)
        local show = params.readStatus
        local show_label = show == "unread" and _("Unread") or show == "reading" and _("Reading") or show == "finished" and _("Finished") or _("All books")
        if context.on_device_filter then show_label = show and (show_label .. " · " .. _("On device")) or _("On device") end
        local lib_label = _("All libraries")
        if params.libraryId then
            for _i, lib in ipairs(self:listLibraries()) do if tostring(lib.id) == tostring(params.libraryId) then lib_label = lib.title end end
            if lib_label == _("All libraries") then lib_label = _("Library") end
        end
        return {
            { icon = "arrow-up-down", label = sort_label, action = { kind = "sort-sheet", focus = "sort" }, key = "tb-sort" },
            { icon = "list-filter", label = show_label, on = show ~= nil or context.on_device_filter == true, action = { kind = "sort-sheet", focus = "show" }, key = "tb-show" },
            { icon = "library", label = lib_label, on = params.libraryId ~= nil, action = { kind = "sort-sheet", focus = "library" }, key = "tb-library" },
        }
    end
    if not self:listsSupported() then return {} end
    local sort = context.sort or "name"
    local sort_label = sort == "books" and _("Most books") or sort == "name_desc" and _("Name Z–A") or _("Name A–Z")
    local filter = context.filter
    local show_label
    if kind == "authors" then show_label = filter == "reading" and _("Reading now") or filter == "finished" and _("Read") or _("Everyone")
    else show_label = filter == "reading" and _("In progress") or filter == "finished" and _("Finished") or _("All series") end
    return {
        { icon = "arrow-up-down", label = sort_label, action = { kind = "sort-sheet", focus = "sort" }, key = "tb-sort" },
        { icon = "list-filter", label = show_label, on = filter ~= nil, action = { kind = "sort-sheet", focus = "show" }, key = "tb-show" },
    }
end

function CatalogLists:listHeader(kind, context)
    local params = context.params or {}
    local clock = datetime.secondsToHour(os.time(), G_reader_settings:isTrue("twelve_hour_clock"))
    if self:isBulkSelectionActive() then
        local n = self.bulk_select_all and (context.total or 0) or self:bulkSelectedCount()
        return { title = T(_("%1 selected"), n), sub = self:listView(kind) == "grid" and _("Tap covers to add or remove") or _("Tap books to add or remove"), select = true, clock = clock }
    end
    if kind == "books" or kind == "reading" then
        local total = context.total or 0
        local sub
        if kind == "reading" then
            sub = T(params.order == "asc" and _("%1 · oldest read first") or _("%1 · last read first"), ListData.bookCount(total))
        else sub = ListData.bookCount(total) .. " · " .. self:listSortLabel(params) end
        return { title = context.title or _("All books"), sub = sub, title_data = true, clock = clock }
    end
    if kind == "authors" or kind == "series" then
        local sort = context.sort or "name"
        local order = sort == "books" and _("most books first") or sort == "name_desc" and _("Z–A") or _("A–Z")
        local count = context.total and (kind == "authors" and ListData.plural(context.total, _("%1 author"), _("%1 authors"))
            or ListData.plural(context.total, _("%1 series"), _("%1 series")))
        if context.dashboard_source_index then
            return { title = kind == "authors" and _("Pick an author") or _("Pick a series"), sub = _("Their books become a shelf on Home"), clock = clock }
        end
        return { title = kind == "authors" and _("Authors") or _("Series"), sub = count and (count .. " · " .. order) or nil, clock = clock }
    end
    if kind == "authorpage" then
        local n = context.total or #(context.books or {})
        return { title = context.title or "", title_data = true, sub = T(_("Author · %1 in your library"), ListData.bookCount(n)), clock = clock }
    end
    if kind == "seriespage" then
        local books = context.books or {}
        local summary = context.series_summary or {}
        local n = tonumber(summary.total) or context.total or #books
        local who = books[1] and books[1].authors and books[1].authors[1]
        return { title = context.title or "", title_data = true, sub = who and (who .. " · " .. ListData.bookCount(n)) or ListData.bookCount(n), clock = clock }
    end
    if kind == "search" then
        local r = context.results or {}
        local n = #(r.authors or {}) + #(r.series or {}) + (r.books_total or #(r.books or {}))
        return { title = _("Search"), sub = T(_("%1 results for “%2”"), n, context.query or ""), clock = clock }
    end
    if kind == "shelves" then
        local s = context.shelves or {}
        local parts = {
            ListData.plural(#(s.libraries or {}), _("%1 library"), _("%1 libraries")),
            ListData.plural(#(s.collections or {}), _("%1 collection"), _("%1 collections")),
            ListData.plural(#(s["smart-scopes"] or {}), _("%1 scope"), _("%1 scopes")),
        }
        if context.dashboard_source_index then
            return { title = _("Pick a shelf"), sub = _("Its books become a shelf on Home"), clock = clock }
        end
        return { title = _("Shelves"), sub = table.concat(parts, " · "), clock = clock }
    end
    return { title = context.title or "", clock = clock }
end

function CatalogLists:listPagerModel(kind, context, m)
    local p = self:listPaging(context)
    local alpha = m and m.rail
    return {
        page = p.page, pages = p.pages, has_prev = p.has_prev, has_next = p.has_next,
        range = alpha and ListData.letterRange(m.letters) or (m and m.range) or nil,
        jump = (p.pages or 1) > 1 or (alpha and true or false),
    }
end

function CatalogLists:listSheetBuilder(kind, context, m)
    local sheet = context.list_sheet
    if not sheet then return nil end
    if sheet.kind == "sort" then
        local model = self:listSortSheetModel(sheet)
        if model.pick then return ListPages.pickSheet(model) end
        return ListPages.sortSheet(model)
    elseif sheet.kind == "jump" then
        local p = self:listPaging(context)
        return ListPages.jumpSheet({
            present = m and m.rail and m.present or nil,
            current = m and m.letters or {},
            page = p.page, pages = p.pages or p.page,
        })
    end
    return nil
end

-- Groups an author's books by series, standalones last.
local function authorGroups(books)
    local groups, by_key = {}, {}
    local sorted = {}
    for i, b in ipairs(books) do sorted[i] = b end
    table.sort(sorted, function(x, y)
        local sx, sy = x.seriesName or "\255", y.seriesName or "\255"
        if sx ~= sy then return sx < sy end
        local ix, iy = tonumber(x.seriesIndex) or 0, tonumber(y.seriesIndex) or 0
        if ix ~= iy then return ix < iy end
        return tostring(x.title) < tostring(y.title)
    end)
    for _i, b in ipairs(sorted) do
        local key = b.seriesName or _("Standalone")
        local g = by_key[key]
        if not g then
            g = { key = key, books = {}, standalone = b.seriesName == nil }
            by_key[key] = g
            table.insert(groups, g)
        end
        table.insert(g.books, b)
    end
    return groups
end

function CatalogLists:listBody(kind, context)
    local sw, sh = self:listScreen()
    if kind == "shelves" then
        local shelves = context.shelves or {}
        local function tag(list, section)
            for _i, e in ipairs(list or {}) do e.section = section end
            return list or {}
        end
        local m = { libraries = tag(shelves.libraries, "libraries"), collections = tag(shelves.collections, "collections"), scopes = tag(shelves["smart-scopes"], "smart-scopes") }
        return function(f) return ListPages.shelvesBody(m, f) end, nil
    end
    if kind == "search" then
        local m = { results = context.results, query = context.query, scope = context.scope or "all", screen_w = sw, screen_h = sh,
            action = function(b) return { kind = "open-book", book = b } end }
        for _i, a in ipairs(context.results.authors or {}) do
            local pb = self:listPhotoBook(a)
            a.photo_path = pb and self:thumbnailDisplay(pb) or nil
        end
        return function(f) return ListPages.searchBody(m, f) end, nil
    end
    if kind == "seriespage" then
        local books = context.books or {}
        local summary = context.series_summary or {}
        local states, indexes = {}, {}
        local next_book, cur
        for i, b in ipairs(books) do
            local st = ListData.stateOf(b)
            states[i] = st == "finished" and "finished" or st == "reading" and "reading" or "unread"
            indexes[i] = b.seriesIndex or i
        end
        for i, b in ipairs(books) do if states[i] == "reading" then next_book, cur = b, i; break end end
        if not next_book then for i, b in ipairs(books) do if states[i] ~= "finished" then next_book, cur = b, i; break end end end
        local finished, reading = 0, 0
        for _i, s in ipairs(states) do if s == "finished" then finished = finished + 1 elseif s == "reading" then reading = reading + 1 end end
        local layout = ListPages.seriesLayout(sw, sh, self:listView(kind), #books, context.list_offline == true)
        context.local_pages = layout.pages
        context.local_page = math.min(context.local_page or 1, layout.pages)
        local lp = context.local_page
        local first = lp == 1 and 1 or (layout.first + (lp - 2) * layout.rest + 1)
        local last = math.min(#books, lp == 1 and layout.first or (first + layout.rest - 1))
        local m = {
            entries = books, view = self:listView(kind), screen_w = sw, screen_h = sh, local_page = context.local_page,
            offline = context.list_offline and {} or nil,
            order_label = (context.params or {}).sort == "title" and _("Title A–Z") or _("Reading order"),
            states = states, indexes = indexes, current_index = cur, next_book = next_book,
            range = #books > 0 and T(_("Books %1 – %2"), first, last) or nil,
            next_minutes = next_book and self:listMinutesLeft(next_book),
            progress = { count = tonumber(summary.total) or #books, finished = tonumber(summary.finished) or finished, reading = tonumber(summary.reading) or reading },
            minutes_left = function(b) return self:listMinutesLeft(b) end,
            action = function(b) return { kind = "open-book", book = b } end,
        }
        return function(f) return ListPages.seriesBody(m, f) end, m
    end
    if kind == "authorpage" then
        local books = context.books or {}
        local summary = context.author_summary or {}
        local finished, reading, on_device = 0, 0, 0
        for _i, b in ipairs(books) do
            local st = ListData.stateOf(b)
            if st == "finished" then finished = finished + 1 elseif st == "reading" then reading = reading + 1 end
            if self:isOnDevice(b) then on_device = on_device + 1 end
        end
        local author = {
            authorId = summary.id, hasPhoto = summary.hasPhoto, name = summary.name or context.title,
            description = summary.description and ListData.cleanBio(CatalogUtil.cleanDescriptionText(summary.description)) or nil,
            birth_year = summary.birthYear, count = context.total or #books, finished = finished, reading = reading, on_device = on_device,
        }
        local m = { author = author, groups = authorGroups(books), view = self:listView(kind), screen_w = sw, screen_h = sh,
            action = function(b) return { kind = "open-book", book = b } end }
        local f = ListView.frame(sw, sh, { toolbar = false, offline = context.list_offline })
        local layout = ListPages.authorLayout(m, f)
        context.local_pages = #layout.pages
        context.local_page = math.min(context.local_page or 1, #layout.pages)
        m.local_page = context.local_page
        return function(f) return ListPages.authorBody(m, f) end, m
    end
    local m = self:listModel(context, kind)
    m.toolbar = (not context.list_offline) or nil
    return function(f) return ListPages.listBody(m, f) end, m
end

-- What the offline band says, and that tapping it tries the server again.
function CatalogLists:listOfflineBand(context)
    local saved = tonumber(context.list_saved_at)
    local ago = saved and saved > 0 and BoardData.relativeDay(os.date("!%Y-%m-%dT%H:%M:%SZ", saved)) or nil
    return {
        note = ago and T(_("saved list from %1. Books on this device open."), ago) or _("saved list. Books on this device open."),
        action = { kind = "reconnect" },
    }
end

-- Builds and shows the current list page.
function CatalogLists:updateListPage(select_number, no_recalculate_dimen)
    local old_dimen = self:prepareCustomUpdate(no_recalculate_dimen)
    self:ensureOnDeviceCurrent()
    local context = self.current_context or {}
    local kind = self:listKind(context)
    local keep = self._list_keep_jump
    if keep and context ~= keep.from then
        self._list_keep_jump = nil
        if kind == keep.kind and not context.list_sheet and os.time() <= keep.until_t then
            local p = self:listPaging(context)
            context.list_sheet = { kind = "jump", page = p.page, pages = p.pages or p.page }
        end
    end
    local sw, sh = self:listScreen()
    local body, m = self:listBody(kind, context)
    -- Offline the band stands in for the toolbar: sorting, filtering and the
    -- view all need the server.
    local has_toolbar = (kind == "books" or kind == "reading" or kind == "authors" or kind == "series") and not context.list_offline
    local toolbar = nil
    if has_toolbar then
        local buttons = self:listToolbar(kind, context)
        toolbar = { buttons = buttons, view = self:listView(kind) }
    end
    local select = self:isBulkSelectionActive()
    local select_bar = nil
    if select then
        local total = context.total or 0
        select_bar = {
            count = self.bulk_select_all and total or self:bulkSelectedCount(),
            actions = {
                { label = T(_("All %1"), total), icon = "check-check", kind = self.bulk_select_all and "solid" or "outline", action = { kind = "select-all" } },
                { label = _("Mark read"), icon = "book-check", action = { kind = "select-mark-read" }, disabled = self.bulk_select_all or self:bulkSelectedCount() == 0 },
                { label = _("Download"), icon = "download", kind = "solid", action = { kind = "select-download" }, disabled = not self.bulk_select_all and self:bulkSelectedCount() == 0 },
            },
        }
    end
    local run = function(action, region, hold) self:listRun(action, region, hold) end
    local ok, screen, rows, regions = pcall(ListView.build, {
        screen_w = self.inner_dimen.w, screen_h = self.available_height, run = run, marks = DUMP_DIR ~= nil,
        env = self:listEnv(),
        header = self:listHeader(kind, context),
        toolbar = toolbar,
        offline = context.list_offline and self:listOfflineBand(context) or nil,
        body = body,
        pager = self:listPagerModel(kind, context, m or {}),
        select_bar = select_bar,
        sheet = self:listSheetBuilder(kind, context, m),
    })
    if not ok then
        logger.err("BookOrbit: list page failed", screen)
        self:finishCustomUpdate(old_dimen, select_number)
        return
    end
    self._list_regions = regions
    table.insert(self.item_group, screen)
    local sheet = context.list_sheet
    for _i, row in ipairs(rows) do
        local id = tostring(row.id)
        local in_sheet = id:match("^sheet") or id:match("^pick%-") or id:match("^jump%-") or id:match("^seg%-")
        if (sheet and in_sheet) or (not sheet and not in_sheet) then table.insert(self.layout, row) end
    end
    self:listScheduleClock()
    self:finishCustomUpdate(old_dimen, select_number)
    self:scheduleThumbnailDownloads(self:listThumbnailBooks(kind, context))
    if DUMP_DIR then UIManager:scheduleIn(0.5, function() self:listDumpRects() end) end
end

-- Every cover and portrait the page shows.
function CatalogLists:listThumbnailBooks(kind, context)
    local out = {}
    local function addBook(b) if b and b.hasCover ~= false then table.insert(out, b) end end
    for _i, b in ipairs(context.books or {}) do addBook(b) end
    local entries = context.entries or {}
    if kind == "shelves" then
        entries = {}
        for _s, list in pairs(context.shelves or {}) do for _i, e in ipairs(list) do table.insert(entries, e) end end
    elseif kind == "search" then
        entries = {}
        for _i, e in ipairs(context.results.authors or {}) do table.insert(entries, e) end
        for _i, e in ipairs(context.results.series or {}) do table.insert(entries, e) end
    end
    for _i, e in ipairs(entries) do
        for _j, b in ipairs(e.previewBooks or {}) do addBook(b) end
        local pb = self:listPhotoBook(e)
        if pb then table.insert(out, pb) end
    end
    if context.author_summary then
        local pb = self:listPhotoBook({ authorId = context.author_summary.id, hasPhoto = context.author_summary.hasPhoto })
        if pb then table.insert(out, pb) end
    end
    return out
end

function CatalogLists:listScheduleClock()
    if self._list_clock_task then UIManager:unschedule(self._list_clock_task) end
    self._list_clock_task = function()
        self._list_clock_task = nil
        if self.catalog_closed or not self:listMode() then return end
        if not self.boardIsTopmost or self:boardIsTopmost() then self:updateItems(nil, true) end
        self:listScheduleClock()
    end
    UIManager:scheduleIn(60 - os.time() % 60 + 1, self._list_clock_task)
end

function CatalogLists:recalculateListPageDimen()
    self.perpage = 1
    self.page = 1
    self.page_num = 1
    local top_height, bottom_height = self:menuChromeHeight()
    self.available_height = self.inner_dimen.h - top_height - bottom_height
    self.item_dimen = require("ui/geometry"):new{ x = 0, y = 0, w = self.inner_dimen.w, h = self.available_height }
end

-- ------------------------------------------------------------- the dump
function CatalogLists:listDumpRects()
    if not DUMP_DIR then return end
    local parts = {}
    for key, r in pairs(self._list_regions or {}) do
        local d = r.dimen
        if d and d.x then table.insert(parts, string.format('"%s":{"x":%d,"y":%d,"w":%d,"h":%d}', key, d.x, d.y, d.w, d.h)) end
    end
    table.sort(parts)
    local f = io.open(DUMP_DIR .. "/list-rects.json", "w")
    if f then f:write("{" .. table.concat(parts, ",") .. "}"); f:close() end
end

function CatalogLists.install(Catalog)
    for name, fn in pairs(CatalogLists) do
        if name ~= "install" and type(fn) == "function" then Catalog[name] = fn end
    end
end

return CatalogLists
