--[[--
Head-index work queue for the sweep's per-book lists.

`table.remove(queue, 1)` shifts every remaining element, so draining a queue
that way costs O(n^2). A LuaJIT microbenchmark measured 0.51 seconds of pure
shifting for 50,000 items against 0.00003 seconds for a head cursor. The stats,
annotation, state and progress queues all grow with the library, so they
consume through a head index instead.

`#queue` stops being the remaining work once the head moves, so progress lines
read `remaining()`, `done()` and `total()` here rather than the array length.
]]

local BookOrbitQueue = {}
BookOrbitQueue.__index = BookOrbitQueue

-- Consumed slots are reclaimed only once they dominate the array, so a long
-- queue never pays a shift per pop.
local COMPACT_MIN_HEAD = 256

function BookOrbitQueue.new(items)
    local self = setmetatable({}, BookOrbitQueue)
    self.items = items or {}
    self.head = 1
    self.tail = #self.items
    self.added = self.tail
    return self
end

function BookOrbitQueue:push(item)
    self.tail = self.tail + 1
    self.items[self.tail] = item
    self.added = self.added + 1
end

function BookOrbitQueue:isEmpty()
    return self.head > self.tail
end

function BookOrbitQueue:remaining()
    local left = self.tail - self.head + 1
    return left > 0 and left or 0
end

-- Everything ever queued. Re-queued entries are retries of work already
-- counted, so they do not move this.
function BookOrbitQueue:total()
    return self.added
end

function BookOrbitQueue:done()
    return self.added - self:remaining()
end

function BookOrbitQueue:peek()
    return self.items[self.head]
end

local function compact(self)
    if self.head <= COMPACT_MIN_HEAD then return end
    if (self.head - 1) * 2 <= self.tail then return end
    local items, target = self.items, 1
    for index = self.head, self.tail do
        items[target] = items[index]
        items[index] = nil
        target = target + 1
    end
    self.tail = target - 1
    self.head = 1
end

function BookOrbitQueue:pop()
    if self.head > self.tail then return nil end
    local item = self.items[self.head]
    self.items[self.head] = nil
    self.head = self.head + 1
    compact(self)
    return item
end

-- Returns a just-popped entry to the front, used by the legacy annotation
-- fallback when it re-queues the in-flight book before switching endpoints.
-- The vacated head slot is reused unless a compaction already reclaimed it.
function BookOrbitQueue:requeue(item)
    if self.head > 1 then
        self.head = self.head - 1
        self.items[self.head] = item
        return
    end
    table.insert(self.items, 1, item)
    self.tail = self.tail + 1
end

-- Iterates the entries that are still queued. Anything walking the queue has
-- to start at the head; index 1 is a consumed slot once the head has moved.
function BookOrbitQueue:iter()
    local index = self.head - 1
    return function()
        index = index + 1
        if index > self.tail then return nil end
        return self.items[index]
    end
end

function BookOrbitQueue:clear()
    self.items = {}
    self.head = 1
    self.tail = 0
    self.added = 0
end

return BookOrbitQueue
