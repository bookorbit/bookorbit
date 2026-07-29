package.path = "koreader-plugin/spec/?.lua;" .. package.path

local FakeScheduler = require("helpers/fake_scheduler")

local scheduler = FakeScheduler.new()
local calls = {}
scheduler:scheduleIn(2, function() table.insert(calls, "later") end)
scheduler:nextTick(function() table.insert(calls, "next") end)
assert(scheduler:pendingCount() == 2)
scheduler:advance(0)
assert(calls[1] == "next")
assert(scheduler:pendingCount() == 1)
scheduler:drain()
assert(calls[2] == "later")
assert(scheduler.now == 2)

print("bookorbit_test_harness_test.lua: ok")
