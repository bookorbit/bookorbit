-- Library-sized sweep phases must yield. Enumeration and sidecar scanning run
-- in bounded chunks, and because the user can open a book between chunks, each
-- phase iterates a snapshot of its keys and re-resolves every entry when its
-- chunk actually runs. A ReadHistory reorder mid-sweep must therefore neither
-- skip nor double-process an entry.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local SweepHarness = require("helpers/sweep_harness")

local HISTORY_CHUNK = 40
local SIDECAR_CHUNK = 20

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

-- Runs one scheduled callback at a time and reports how much work each did, so
-- "the phase yields" is proven by the slice sizes rather than assumed.
local function drainMeasuring(harness, count)
    local slices = {}
    local previous = count()
    while harness.scheduler:runOne() do
        local current = count()
        if current > previous then
            table.insert(slices, current - previous)
            previous = current
        end
    end
    return slices
end

local function maxOf(values)
    local largest = 0
    for _, value in ipairs(values) do
        if value > largest then largest = value end
    end
    return largest
end

-- ReadHistory resolution.
do
    local history = {}
    for index = 1, 100 do
        table.insert(history, { file = string.format("/books/%03d.epub", index), time = index, text = "Book" })
    end

    local harness = SweepHarness.install{
        history = history,
        has_sidecar_files = true,
        library_version = "v1",
    }

    local seen, total = {}, 0
    package.loaded["util"].partialMD5 = function(file)
        seen[file] = (seen[file] or 0) + 1
        total = total + 1
        if total == HISTORY_CHUNK then
            -- Opening a book mid-sweep reorders the live list and can drop an
            -- entry the snapshot still names.
            local reordered = {}
            for index = #harness.history, 1, -1 do
                local item = harness.history[index]
                if item.file ~= "/books/041.epub" then
                    table.insert(reordered, item)
                end
            end
            package.loaded["readhistory"].hist = reordered
        end
        return "md5-" .. file
    end

    local Sweep = require("bookorbit_sweep")
    assertEqual(Sweep.run{ api = {}, interactive = true, annotation_sync = false }, true, "the sweep starts")

    local slices = drainMeasuring(harness, function() return total end)

    assertEqual(total, 99, "every entry that still exists is resolved exactly once")
    assertEqual(seen["/books/041.epub"], nil, "an entry removed mid-sweep is tolerated, not resolved")
    for index = 1, 100 do
        local file = string.format("/books/%03d.epub", index)
        if file ~= "/books/041.epub" then
            assertEqual(seen[file], 1, "no entry is processed twice after the list reorders")
        end
    end

    assert(#slices > 1, "resolution is split across scheduled callbacks")
    assert(maxOf(slices) <= HISTORY_CHUNK,
        "no single callback resolves more than the chunk size, got " .. maxOf(slices))
end

-- Matched-book sidecar scanning.
do
    local books = {}
    for index = 1, 50 do
        books[string.format("digest%02d", index)] = {
            bookId = index,
            fileId = 100 + index,
            file = string.format("/books/%02d.epub", index),
            statsWatermark = 0,
            annWatermark = "",
            annCount = 0,
            sidecarMtime = 1,
            ratingSyncedKnown = true,
            reviewSyncedKnown = true,
            matchVerifiedAt = os.time(),
            matchVerifiedVersion = "v1",
        }
    end

    local scanned, total = {}, 0
    local harness = SweepHarness.install{
        library_version = "v1",
        state = { books = books, global = { libraryVersion = "v1" } },
        sidecar = {
            sidecarMtime = function(file)
                scanned[file] = (scanned[file] or 0) + 1
                total = total + 1
                return 1
            end,
        },
    }

    local Sweep = require("bookorbit_sweep")
    assertEqual(Sweep.run{ api = {}, interactive = true, annotation_sync = false }, true, "the sweep starts")

    local slices = drainMeasuring(harness, function() return total end)

    assertEqual(total, 50, "every matched book is scanned exactly once")
    for index = 1, 50 do
        assertEqual(scanned[string.format("/books/%02d.epub", index)], 1, "no book is scanned twice")
    end
    assert(#slices > 1, "sidecar scanning is split across scheduled callbacks")
    assert(maxOf(slices) <= SIDECAR_CHUNK,
        "no single callback scans more than the chunk size, got " .. maxOf(slices))
    assertEqual(#harness.calls.match, 0, "books verified inside the age bound issue no match request")
end

print("bookorbit_sweep_chunking_test.lua: ok")
