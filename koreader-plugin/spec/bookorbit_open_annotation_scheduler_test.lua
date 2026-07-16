package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local OpenAnnotationScheduler = require("bookorbit_open_annotation_scheduler")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function newHarness()
    local timers = {}
    local scheduler = OpenAnnotationScheduler.new{
        delay = 2,
        schedule_in = function(delay, callback)
            table.insert(timers, { delay = delay, callback = callback })
        end,
    }
    local harness = {
        timers = timers,
        scheduler = scheduler,
    }
    function harness:runNext()
        local timer = table.remove(self.timers, 1)
        if timer then
            timer.callback()
        end
    end
    return harness
end

local function newPlugin(opts)
    opts = opts or {}
    local plugin = {
        digest = opts.digest or "digest-a",
        matched = opts.matched == true,
        match_results = opts.match_results or {},
        exchanges = {},
        unmatched = 0,
        match_calls = 0,
    }

    function plugin:getDocumentDigest()
        return self.digest
    end

    function plugin:shouldSkipAutoSyncOffline()
        return false
    end

    function plugin:isOpenBookMatched()
        return self.matched
    end

    function plugin:requestAnnotationExchange(reason)
        table.insert(self.exchanges, reason)
    end

    function plugin:recordOpenAnnotationUnmatched(reason)
        self.unmatched = self.unmatched + 1
        self.unmatched_reason = reason
    end

    function plugin:matchOpenBookForAutoSync(callback)
        self.match_calls = self.match_calls + 1
        local matched = table.remove(self.match_results, 1) == true
        self.matched = matched
        callback(matched)
    end

    return plugin
end

local harness = newHarness()
local plugin = newPlugin{ matched = true }
harness.scheduler:schedule(plugin, "digest-a", "annotation_open")
harness.scheduler:schedule(plugin, "digest-a", "annotation_open")
assertEqual(#harness.timers, 2, "replacement keeps old timer callback queued")
assertEqual(harness.timers[1].delay, 2, "open annotation delay is used")
harness:runNext()
assertEqual(#plugin.exchanges, 0, "replaced timer does not run exchange")
harness:runNext()
assertEqual(#plugin.exchanges, 1, "latest timer runs one exchange")
assertEqual(plugin.exchanges[1], "annotation_open", "exchange uses open annotation reason")

harness = newHarness()
plugin = newPlugin{ matched = false, match_results = { true } }
harness.scheduler:schedule(plugin, "digest-a", "annotation_open")
harness:runNext()
assertEqual(plugin.match_calls, 1, "unmatched fire retries match once")
assertEqual(#plugin.exchanges, 0, "match success reschedules instead of exchanging immediately")
assertEqual(#harness.timers, 1, "match success schedules another settled sync")
harness:runNext()
assertEqual(#plugin.exchanges, 1, "newly matched book exchanges after second delay")

harness = newHarness()
plugin = newPlugin{ matched = false, match_results = { false } }
harness.scheduler:schedule(plugin, "digest-a", "annotation_open")
harness:runNext()
assertEqual(plugin.match_calls, 1, "unmatched book gets one match retry")
assertEqual(plugin.unmatched, 1, "failed retry records unmatched")
assertEqual(plugin.unmatched_reason, "annotation_open", "unmatched keeps reason")
assertEqual(#plugin.exchanges, 0, "failed retry does not exchange")

harness = newHarness()
plugin = newPlugin{ matched = true }
harness.scheduler:schedule(plugin, "digest-a", "annotation_open")
plugin.digest = "digest-b"
harness:runNext()
assertEqual(#plugin.exchanges, 0, "stale timer does not sync a different open book")
assertEqual(plugin.unmatched, 0, "stale timer does not record unmatched")

print("bookorbit_open_annotation_scheduler_test.lua: ok")
