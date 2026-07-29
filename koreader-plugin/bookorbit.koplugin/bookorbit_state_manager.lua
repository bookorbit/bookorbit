--[[--
Single owner of the plugin's persistent sync state.

BookOrbitState reparses bookorbit_sync_state.lua through dofile() on every
open, and the catalog additionally derived its on-device maps from a fresh
open on every repaint. This manager keeps one private persistent owner and
gives workflows isolated, optionally scoped sessions. Session flushes use a
three-way merge so an older workflow cannot overwrite already-published state.

Immediate mutations join the outermost transaction and flush once. Derived
on-device maps are cached against the published generation.
]]

local BookOrbitState = require("bookorbit_state")

local StateManager = {}

local LIBRARY_VERSION_TOUCH_INTERVAL = 3600

local shared
local generation = 0
local active_mutation
local maps
local maps_generation = -1

local function deepCopy(value)
    if type(value) ~= "table" then return value end
    local copy = {}
    for key, item in pairs(value) do
        copy[deepCopy(key)] = deepCopy(item)
    end
    return copy
end

local function deepEqual(a, b, seen)
    if a == b then return true end
    if type(a) ~= "table" or type(b) ~= "table" then return false end
    seen = seen or {}
    if seen[a] == b then return true end
    seen[a] = b
    for key, value in pairs(a) do
        if not deepEqual(value, b[key], seen) then return false end
    end
    for key in pairs(b) do
        if a[key] == nil then return false end
    end
    return true
end

-- Three-way merge used when a long-running session flushes after another
-- scoped writer. Unchanged session fields inherit the current value; unchanged
-- current fields accept the session value. If both changed the same scalar,
-- the already-published current value wins instead of being overwritten.
local function mergeValue(base, working, current)
    if deepEqual(working, current) then return deepCopy(working) end
    if deepEqual(working, base) then return deepCopy(current) end
    if deepEqual(current, base) then return deepCopy(working) end
    if type(base) == "table" and type(working) == "table" and type(current) == "table" then
        local result = {}
        local keys = {}
        for key in pairs(base) do keys[key] = true end
        for key in pairs(working) do keys[key] = true end
        for key in pairs(current) do keys[key] = true end
        for key in pairs(keys) do
            result[key] = mergeValue(base[key], working[key], current[key])
        end
        return result
    end
    return deepCopy(current)
end

local function replaceTable(target, source)
    for key in pairs(target) do target[key] = nil end
    for key, value in pairs(source or {}) do target[key] = deepCopy(value) end
end

local function mapToEntries(map)
    local entries = {}
    for id, file in pairs(map) do
        table.insert(entries, { id = id, file = file })
    end
    table.sort(entries, function(a, b)
        return a.id < b.id
    end)
    return entries
end

local function entriesToMap(entries)
    if type(entries) ~= "table" then return nil end
    local map = {}
    for _, entry in ipairs(entries) do
        if type(entry) ~= "table"
                or type(entry.id) ~= "number"
                or entry.id <= 0
                or entry.id % 1 ~= 0
                or type(entry.file) ~= "string"
                or entry.file == "" then
            return nil
        end
        map[entry.id] = entry.file
    end
    return map
end

local function publish()
    generation = generation + 1
    maps = nil
    maps_generation = -1
end

local function ensure()
    if not shared then
        shared = BookOrbitState.open()
        shared.on_flush = publish
        publish()
    end
    return shared
end

local function scopeTables(state, scope)
    if scope.full then
        return {
            books = state.books,
            unmatched = state.unmatched,
            files = state.files,
            global = state.global,
        }
    end

    local tables = { books = {}, unmatched = {}, files = {}, global = {} }
    for digest in pairs(scope.digests) do
        tables.books[digest] = state.books[digest]
        tables.unmatched[digest] = state.unmatched[digest]
    end
    for file in pairs(scope.files) do
        tables.files[file] = state.files[file]
    end
    if scope.global then tables.global = state.global end
    return tables
end

local function normalizeScope(opts)
    if not opts or opts.full then
        return { full = true, digests = {}, files = {}, global = true }
    end
    local scope = { full = false, digests = {}, files = {}, global = opts.global ~= false }
    for _, digest in ipairs(opts.digests or {}) do
        if digest then scope.digests[digest] = true end
    end
    for _, file in ipairs(opts.files or {}) do
        if file then scope.files[file] = true end
    end
    return scope
end

local function refreshSession(session)
    local current = scopeTables(ensure(), session.manager_scope)
    session.books = deepCopy(current.books)
    session.unmatched = deepCopy(current.unmatched)
    session.files = deepCopy(current.files)
    session.global = deepCopy(current.global)
    session.manager_base = deepCopy(current)
    session.manager_generation = generation
end

local function commitSession(session)
    local state = ensure()
    local scope = session.manager_scope
    local base = session.manager_base

    if scope.full then
        replaceTable(state.books, mergeValue(base.books, session.books, state.books))
        replaceTable(state.unmatched, mergeValue(base.unmatched, session.unmatched, state.unmatched))
        replaceTable(state.files, mergeValue(base.files, session.files, state.files))
        replaceTable(state.global, mergeValue(base.global, session.global, state.global))
    else
        for digest in pairs(scope.digests) do
            state.books[digest] = mergeValue(base.books[digest], session.books[digest], state.books[digest])
            state.unmatched[digest] = mergeValue(
                base.unmatched[digest], session.unmatched[digest], state.unmatched[digest])
        end
        for file in pairs(scope.files) do
            state.files[file] = mergeValue(base.files[file], session.files[file], state.files[file])
        end
        if scope.global then
            replaceTable(state.global, mergeValue(base.global, session.global, state.global))
        end
    end

    local flushed, flush_err = pcall(state.flush, state)
    if not flushed then
        state:reload()
        publish()
        error(flush_err, 0)
    end
    refreshSession(session)
    return generation
end

function StateManager.session(opts)
    local scope = normalizeScope(opts)
    local initial = scopeTables(ensure(), scope)
    local session
    session = BookOrbitState.snapshot(initial, function()
        return commitSession(session)
    end)
    session.manager_scope = scope
    session.manager_base = deepCopy(initial)
    session.manager_generation = generation
    return session
end

-- Compatibility alias for older callers. It returns an isolated session, not
-- the manager's mutable live state.
function StateManager.state()
    return StateManager.session()
end

function StateManager.getBook(digest)
    return deepCopy(ensure():getBook(digest))
end

function StateManager.summary()
    local state = ensure()
    local matched, unmatched = 0, 0
    for _ in pairs(state.books) do matched = matched + 1 end
    for _ in pairs(state.unmatched) do unmatched = unmatched + 1 end
    return {
        matched = matched,
        unmatched = unmatched,
        lastSweepAt = state.global.lastSweepAt or 0,
        needsFullRecheck = state.global.needsFullRecheck == true,
    }
end

function StateManager.generation()
    return generation
end

-- Routes a library-version token observed on any response into the shared
-- invalidation path. Every flush rewrites the whole state file, so an already
-- known token only refreshes its observation stamp once per interval. This is
-- an observation, not the caller's work, so a failed flush is reported rather
-- than raised into a download or catalog request.
function StateManager.applyLibraryVersion(version)
    if type(version) ~= "string" or version == "" then return generation end
    local state = ensure()
    local checked_at = state.global.libraryVersionCheckedAt
    if state.global.libraryVersion == version and type(checked_at) == "number"
            and os.time() - checked_at < LIBRARY_VERSION_TOUCH_INTERVAL then
        return generation
    end
    local ok, result = pcall(StateManager.mutate, function(session)
        BookOrbitState.applyLibraryVersion(session, version)
    end)
    if not ok then return nil, result end
    return result
end

-- Re-reads the settings file in place. Use when another process may have
-- written it; holders of the shared instance observe the reloaded tables.
function StateManager.reload()
    ensure():reload()
    publish()
    return generation
end

-- Drops only the derived caches, keeping the parsed state.
function StateManager.invalidate()
    publish()
end

function StateManager.mutate(fn)
    if active_mutation then
        local ok, err = pcall(fn, active_mutation)
        if not ok then error(err, 0) end
        return generation
    end

    local session = StateManager.session()
    active_mutation = session
    local ok, err = pcall(fn, session)
    active_mutation = nil
    if not ok then
        error(err, 0)
    end
    return session:flush()
end

function StateManager.mutateScoped(opts, fn)
    if active_mutation then
        local ok, err = pcall(fn, active_mutation)
        if not ok then error(err, 0) end
        return generation
    end
    local session = StateManager.session(opts)
    active_mutation = session
    local ok, err = pcall(fn, session)
    active_mutation = nil
    if not ok then error(err, 0) end
    return session:flush()
end

-- Refuses a change prepared against an older generation, so a caller that
-- computed its update before another path published cannot clobber it.
function StateManager.commit(expected_generation, fn)
    ensure()
    if expected_generation ~= nil and expected_generation ~= generation then
        return nil, "stale_generation"
    end
    return StateManager.mutate(fn)
end

function StateManager.onDeviceMaps()
    if maps and maps_generation == generation then
        return maps
    end
    local state = ensure()
    local by_book_id, by_file_id = state:matchedFileMaps()
    maps = { byBookId = by_book_id, byFileId = by_file_id, generation = generation }
    maps_generation = generation
    return maps
end

function StateManager.hasOnDeviceMaps()
    return maps ~= nil and maps_generation == generation
end

-- Safe to call in a subprocess. Sparse numeric-key maps do not survive the
-- JSON subprocess envelope, so the child returns sequential records and the
-- parent rebuilds lookup maps only if the generation is still current.
function StateManager.computeOnDeviceMaps()
    local state = shared or BookOrbitState.open()
    local by_book_id, by_file_id = state:matchedFileMaps()
    return {
        bookEntries = mapToEntries(by_book_id),
        fileEntries = mapToEntries(by_file_id),
        generation = generation,
    }
end

function StateManager.adoptOnDeviceMaps(computed)
    if type(computed) ~= "table" or computed.generation ~= generation then
        return nil, "stale_generation"
    end
    local by_book_id = entriesToMap(computed.bookEntries)
    local by_file_id = entriesToMap(computed.fileEntries)
    if not by_book_id or not by_file_id then
        return nil, "invalid_maps"
    end
    maps = {
        byBookId = by_book_id,
        byFileId = by_file_id,
        generation = computed.generation,
    }
    maps_generation = generation
    return maps
end

-- Links freshly downloaded files in one scoped mutation and patches stable
-- cached identities forward. Every flush rewrites the whole settings file, so
-- bulk callers batch their links instead of flushing per file. A changed
-- identity leaves the maps invalidated for asynchronous reconciliation because
-- another local format may still own the old ID.
function StateManager.linkFiles(entries)
    entries = entries or {}
    if #entries == 0 then return generation end

    local previous = maps
    local state = ensure()
    local digests, files, prior = {}, {}, {}
    for _, entry in ipairs(entries) do
        table.insert(digests, entry.digest)
        if entry.file then table.insert(files, entry.file) end
        prior[entry.digest] = deepCopy(state.books[entry.digest])
    end

    -- The global scope is included so setMatched() can stamp each link against
    -- the library version this session knows; it is read, never written here.
    local gen = StateManager.mutateScoped({
        digests = digests,
        files = files,
    }, function(session)
        for _, entry in ipairs(entries) do
            session:rememberFile(entry.file, entry.digest)
            session:setMatched(entry.digest, entry.bookFileId, entry.bookId, entry.file)
        end
    end)

    local ids_unchanged = true
    for _, entry in ipairs(entries) do
        local before = prior[entry.digest]
        if before and (before.bookId ~= entry.bookId or before.fileId ~= entry.bookFileId) then
            ids_unchanged = false
            break
        end
    end
    if previous and ids_unchanged then
        for _, entry in ipairs(entries) do
            if entry.file then
                if entry.bookId then previous.byBookId[entry.bookId] = entry.file end
                if entry.bookFileId then previous.byFileId[entry.bookFileId] = entry.file end
            end
        end
        previous.generation = gen
        maps = previous
        maps_generation = gen
    end
    return gen
end

function StateManager.linkFile(digest, book_file_id, book_id, file)
    return StateManager.linkFiles({
        { digest = digest, bookFileId = book_file_id, bookId = book_id, file = file },
    })
end

-- Test seam: forgets the shared instance and every derived cache.
function StateManager.reset()
    shared = nil
    maps = nil
    maps_generation = -1
    generation = 0
    active_mutation = nil
end

return StateManager
