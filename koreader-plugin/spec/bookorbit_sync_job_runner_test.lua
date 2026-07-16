local wrapped_calls = 0
local logged_errors = 0

package.loaded["ui/trapper"] = {
    wrap = function(_, fn)
        wrapped_calls = wrapped_calls + 1
        fn()
    end,
}

package.loaded["logger"] = {
    err = function()
        logged_errors = logged_errors + 1
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local SyncJobRunner = require("bookorbit_sync_job_runner")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local completed = 0
local sync_calls = 0
local sync_job = SyncJobRunner.prepare{
    run = function()
        sync_calls = sync_calls + 1
    end,
}
sync_job.run(function()
    completed = completed + 1
end, sync_job)
assertEqual(sync_job.async, true, "prepared synchronous job uses async coordinator lifecycle")
assertEqual(sync_calls, 1, "synchronous job runs once")
assertEqual(completed, 1, "synchronous job completes after wrapped work")
assertEqual(wrapped_calls, 1, "synchronous job runs in Trapper coroutine")

local async_done
local async_job = SyncJobRunner.prepare{
    async = true,
    run = function(done)
        async_done = done
    end,
}
async_job.run(function()
    completed = completed + 1
end, async_job)
assertEqual(completed, 1, "asynchronous job controls its own completion")
async_done()
assertEqual(completed, 2, "asynchronous completion reaches coordinator callback")

local failed_job = SyncJobRunner.prepare{
    run = function()
        error("expected failure")
    end,
}
failed_job.run(function()
    completed = completed + 1
end, failed_job)
assertEqual(completed, 3, "failed job releases coordinator")
assertEqual(logged_errors, 1, "failed job is logged")

print("bookorbit_sync_job_runner_test.lua: ok")
