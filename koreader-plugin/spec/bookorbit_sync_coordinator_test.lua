package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local SyncCoordinator = require("bookorbit_sync_coordinator")

local now = 1000

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function newCoordinator()
    return SyncCoordinator.new{
        now = function()
            return now
        end,
    }
end

local function asyncJob(label, priority, calls, done_ref)
    return {
        family = label,
        label = label,
        priority = priority,
        async = true,
        run = function(done)
            table.insert(calls, label)
            done_ref[label] = done
        end,
    }
end

local coordinator = newCoordinator()
local calls = {}
local done_ref = {}
coordinator:submit(asyncJob("current", SyncCoordinator.PRIORITY.auto, calls, done_ref))
assertEqual(calls[1], "current", "first job starts immediately")
assertEqual(coordinator:status().current.label, "current", "current status is exported")

coordinator:submit(asyncJob("progress_pull", SyncCoordinator.PRIORITY.auto, calls, done_ref))
coordinator:submit(asyncJob("progress_pull", SyncCoordinator.PRIORITY.auto, calls, done_ref))
assertEqual(coordinator:status().pending_count, 1, "same family coalesces to one pending job")
done_ref.current()
assertEqual(calls[2], "progress_pull", "coalesced job starts after current")
done_ref.progress_pull()
assertEqual(coordinator:status().pending_count, 0, "queue drains after coalesced job")

coordinator = newCoordinator()
calls = {}
done_ref = {}
coordinator:submit(asyncJob("current", SyncCoordinator.PRIORITY.auto, calls, done_ref))
coordinator:submit(asyncJob("annotation_exchange", SyncCoordinator.PRIORITY.auto, calls, done_ref))
coordinator:submit(asyncJob("progress_push", SyncCoordinator.PRIORITY.auto, calls, done_ref))
coordinator:submit(asyncJob("progress_push", SyncCoordinator.PRIORITY.manual, calls, done_ref))
assertEqual(coordinator:status().pending_count, 2, "manual replacement keeps one job per family")
assertEqual(coordinator:status().next.label, "progress_push", "manual job has next priority")
done_ref.current()
assertEqual(calls[2], "progress_push", "manual job runs before auto pending job")
done_ref.progress_push()
assertEqual(calls[3], "annotation_exchange", "remaining auto job runs after manual job")

coordinator = newCoordinator()
calls = {}
done_ref = {}
coordinator:submit(asyncJob("current", SyncCoordinator.PRIORITY.auto, calls, done_ref))
coordinator:submit(asyncJob("sweep", SyncCoordinator.PRIORITY.manual, calls, done_ref))
coordinator:submit(asyncJob("book_snapshot", SyncCoordinator.PRIORITY.lifecycle, calls, done_ref))
assertEqual(coordinator:status().next.label, "book_snapshot", "lifecycle job outranks manual pending job")
done_ref.current()
assertEqual(calls[2], "book_snapshot", "lifecycle job runs first")

coordinator = newCoordinator()
calls = {}
done_ref = {}
coordinator:submit(asyncJob("current", SyncCoordinator.PRIORITY.auto, calls, done_ref))
now = 1015
coordinator:submit(asyncJob("sweep", SyncCoordinator.PRIORITY.manual, calls, done_ref))
local status = coordinator:status()
assertEqual(status.current.label, "current", "status reports current label")
assertEqual(status.current.age, 15, "status reports current age")
assertEqual(status.pending_count, 1, "status reports pending count")
assertEqual(status.next.label, "sweep", "status reports next pending job")

print("bookorbit_sync_coordinator_test.lua: ok")
