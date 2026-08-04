-- "Not on device" is the one book source with no server-side filter behind it:
-- which books are linked is local KOReader state the server never sees. The
-- list is therefore walked client-side, and what matters is that the walk stays
-- bounded on a large library, stops as soon as the server runs out of pages,
-- and reports a failed page instead of silently returning a short list.

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

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogUtil = require("bookorbit_catalog_util")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function books(from, to)
    local items = {}
    for id = from, to do
        table.insert(items, { id = id })
    end
    return items
end

local function pager(pages)
    local requested = {}
    return function(page)
        table.insert(requested, page)
        local body = pages[page]
        if not body then return nil, 500 end
        return body
    end, requested
end

local function keepAll() return false end

-- The books already here are dropped, and the rest keep the server's order.
local fetch, requested = pager({
    { items = { { id = 1 }, { id = 2 }, { id = 3 }, { id = 4 } }, hasNext = false },
})
local on_device = { [2] = true, [4] = true }
local ids = CatalogUtil.scanNotOnDeviceIds(fetch, function(book)
    return on_device[book.id] == true
end)
assertEqual(#ids, 2, "linked books are dropped")
assertEqual(ids[1], 1, "first kept id")
assertEqual(ids[2], 3, "order follows the server")
assertEqual(#requested, 1, "a single page was enough")

-- A book with no id cannot be asked for again, so it never reaches the list.
local unidentified = CatalogUtil.scanNotOnDeviceIds(function()
    return { items = { { id = 1 }, {}, { id = 3 } }, hasNext = false }
end, keepAll)
assertEqual(#unidentified, 2, "an entry without an id is skipped")

-- hasNext false ends the walk even though the page budget is not spent.
local short_fetch, short_requested = pager({
    { items = books(1, 10), hasNext = true },
    { items = books(11, 15), hasNext = false },
    { items = books(16, 20), hasNext = true },
})
local short = CatalogUtil.scanNotOnDeviceIds(short_fetch, keepAll)
assertEqual(#short, 15, "the walk stops when the server says there is no next page")
assertEqual(#short_requested, 2, "no page is requested past the end")

-- A library larger than the walk never turns into an unbounded scan: the page
-- budget caps the requests whatever the server keeps offering.
local endless_pages = {}
for page = 1, CatalogUtil.NOT_ON_DEVICE_SCAN_PAGES + 3 do
    endless_pages[page] = { items = books((page - 1) * 10 + 1, page * 10), hasNext = true }
end
local endless_fetch, endless_requested = pager(endless_pages)
local bounded = CatalogUtil.scanNotOnDeviceIds(endless_fetch, keepAll)
assertEqual(#endless_requested, CatalogUtil.NOT_ON_DEVICE_SCAN_PAGES, "the page budget bounds the walk")
assertEqual(#bounded, CatalogUtil.NOT_ON_DEVICE_SCAN_PAGES * 10, "every scanned book is kept")

-- The server caps its ids filter, so the walk stops collecting at that cap
-- rather than building a list the follow-up request would reject.
local cap_pages = {}
for page = 1, CatalogUtil.NOT_ON_DEVICE_SCAN_PAGES do
    local from = (page - 1) * CatalogUtil.NOT_ON_DEVICE_SCAN_SIZE + 1
    cap_pages[page] = {
        items = books(from, from + CatalogUtil.NOT_ON_DEVICE_SCAN_SIZE - 1),
        hasNext = true,
    }
end
local cap_fetch, cap_requested = pager(cap_pages)
local capped = CatalogUtil.scanNotOnDeviceIds(cap_fetch, keepAll)
assertEqual(#capped, CatalogUtil.NOT_ON_DEVICE_MAX_IDS, "collection stops at the ids cap")
assertEqual(
    #cap_requested <= CatalogUtil.NOT_ON_DEVICE_SCAN_PAGES,
    true,
    "the cap is reached without exceeding the page budget"
)

-- A failed page is an error, not a short list: returning what was gathered so
-- far would read as "these are the books you are missing".
local failed, err = CatalogUtil.scanNotOnDeviceIds(function(page)
    if page == 1 then return { items = books(1, 10), hasNext = true } end
    return nil, 503
end, keepAll)
assertEqual(failed, nil, "a failed page returns no list")
assertEqual(err, 503, "the fetch error is passed through")

-- Cancelling mid-walk has to stay distinguishable so the caller can stay quiet
-- rather than offering a retry the user did not ask for.
local _, cancelled = CatalogUtil.scanNotOnDeviceIds(function()
    return nil, "cancelled"
end, keepAll)
assertEqual(cancelled, "cancelled", "cancellation is reported as itself")

-- Everything already here is the empty case the caller messages separately.
local none = CatalogUtil.scanNotOnDeviceIds(function()
    return { items = books(1, 5), hasNext = false }
end, function() return true end)
assertEqual(#none, 0, "a fully downloaded library yields nothing")

print("bookorbit_not_on_device_test.lua: ok")
