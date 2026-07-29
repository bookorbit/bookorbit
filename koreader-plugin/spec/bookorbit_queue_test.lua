-- The sweep queues drain through a head index, not table.remove(queue, 1).
-- Front removal shifts every remaining element, so consuming a library-sized
-- queue that way is quadratic. These assertions check the mechanics that make
-- it linear: consuming never moves an element, progress comes from explicit
-- counters rather than the array length, and everything that walks the queue
-- starts at the head.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitQueue = require("bookorbit_queue")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function build(count)
    local items = {}
    for index = 1, count do
        table.insert(items, index)
    end
    return BookOrbitQueue.new(items)
end

-- Consuming advances a cursor; the remaining elements keep their slots.
do
    local queue = build(10)
    assertEqual(queue:pop(), 1, "the first pop returns the first item")
    assertEqual(queue:pop(), 2, "the second pop returns the second item")
    assertEqual(queue.items[1], nil, "a consumed slot is released rather than back-filled")
    assertEqual(queue.items[3], 3, "surviving elements are not shifted down")
    assertEqual(queue.head, 3, "the head cursor is what moved")
    assertEqual(queue:peek(), 3, "peek reads through the head")
end

-- Progress counters, which is what the stats and annotation progress lines use.
do
    local queue = build(5)
    assertEqual(queue:total(), 5, "the total is everything ever queued")
    assertEqual(queue:remaining(), 5, "nothing is consumed yet")
    assertEqual(queue:done(), 0, "nothing is done yet")
    queue:pop()
    queue:pop()
    assertEqual(queue:remaining(), 3, "remaining tracks the head")
    assertEqual(queue:done(), 2, "done is derived from the counters, not the array length")
    queue:push(6)
    assertEqual(queue:total(), 6, "a late push raises the total")
    assertEqual(queue:remaining(), 4, "and the remaining work")
end

-- The legacy annotation fallback returns the in-flight entry to the front.
do
    local queue = build(4)
    local entry = queue:pop()
    assertEqual(queue:done(), 1, "the entry counts as done while it is in flight")
    queue:requeue(entry)
    assertEqual(queue:remaining(), 4, "re-queuing restores the remaining work")
    assertEqual(queue:done(), 0, "and the done count")
    assertEqual(queue:total(), 4, "a retry does not inflate the total")
    assertEqual(queue:pop(), 1, "the re-queued entry comes back first")
    assertEqual(queue:pop(), 2, "the rest of the order is preserved")
end

-- Re-queuing with nothing consumed still has to work.
do
    local queue = build(2)
    queue:requeue(0)
    assertEqual(queue:remaining(), 3, "the entry is added at the front")
    assertEqual(queue:pop(), 0, "and comes out first")
    assertEqual(queue:pop(), 1, "ahead of the original head")
end

-- buildLegacyAnnotationChunks walks the queue while entries are already
-- consumed, so iteration must start at the head and not at index 1.
do
    local queue = build(5)
    queue:pop()
    queue:pop()
    local walked = {}
    for item in queue:iter() do
        table.insert(walked, item)
    end
    assertEqual(table.concat(walked, ","), "3,4,5", "iteration skips consumed slots")
    queue:clear()
    assertEqual(queue:isEmpty(), true, "clearing empties the queue")
    assertEqual(queue:total(), 0, "and resets the counters")
end

-- Compaction reclaims consumed slots without disturbing order or counters.
do
    local queue = build(600)
    for index = 1, 500 do
        assertEqual(queue:pop(), index, "items come out in order across a compaction")
    end
    assert(queue.head < 501, "consumed slots are reclaimed rather than kept forever")
    assertEqual(queue:remaining(), 100, "the remaining work survives compaction")
    assertEqual(queue:done(), 500, "and so does the done count")
    assertEqual(queue:pop(), 501, "the order is unchanged after compaction")
end

-- Draining a large queue must stay linear. Front removal of 50,000 items costs
-- roughly half a second of pure shifting on a development machine; the bound
-- here is deliberately loose so it fails only on a quadratic regression.
do
    local queue = build(50000)
    local started = os.clock()
    local count = 0
    while not queue:isEmpty() do
        queue:pop()
        count = count + 1
    end
    local elapsed = os.clock() - started
    assertEqual(count, 50000, "every item is consumed")
    assert(elapsed < 0.2, string.format("draining 50,000 items took %.3fs, expected linear behavior", elapsed))
end

print("bookorbit_queue_test.lua: ok")
