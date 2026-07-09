--[[--
Small sync job coordinator for the BookOrbit plugin.

It serializes sync work, coalesces pending jobs by family and lets callers
export a compact status snapshot for diagnostics. The coordinator deliberately
does not know about KOReader widgets or BookOrbit APIs; jobs provide the work.
]]

local SyncCoordinator = {}
SyncCoordinator.__index = SyncCoordinator

SyncCoordinator.PRIORITY = {
    auto = 100,
    manual = 200,
    lifecycle = 300,
}

function SyncCoordinator.new(opts)
    opts = opts or {}
    return setmetatable({
        now = opts.now or os.time,
        current = nil,
        pending = {},
        pending_count = 0,
        next_seq = 0,
    }, SyncCoordinator)
end

local function copyJobStatus(job, now)
    if not job then return nil end
    local started_at = job.started_at
    local status = {
        family = job.family,
        label = job.label or job.family,
        source = job.source,
        interactive = job.interactive == true,
        priority = job.priority,
        created_at = job.created_at,
        started_at = started_at,
    }
    if started_at then
        status.age = math.max(0, now - started_at)
    end
    return status
end

function SyncCoordinator:isBusy()
    return self.current ~= nil
end

function SyncCoordinator:queuedCount()
    return self.pending_count
end

function SyncCoordinator:coalesce(job)
    local existing = self.pending[job.family]
    if existing and existing.priority > job.priority then
        return "kept", existing
    end
    if not existing then
        self.pending_count = self.pending_count + 1
    end
    self.pending[job.family] = job
    return "queued", job
end

function SyncCoordinator:nextPending()
    local best_family, best_job
    for family, job in pairs(self.pending) do
        if not best_job
                or job.priority > best_job.priority
                or (job.priority == best_job.priority and job.seq < best_job.seq) then
            best_family = family
            best_job = job
        end
    end
    return best_family, best_job
end

function SyncCoordinator:startNext()
    local family, job = self:nextPending()
    if not job then return end
    self.pending[family] = nil
    self.pending_count = self.pending_count - 1
    self:start(job)
end

function SyncCoordinator:start(job)
    self.current = job
    job.started_at = self.now()

    local finished = false
    local function done()
        if finished then return end
        finished = true
        if self.current == job then
            self.current = nil
            self:startNext()
        end
    end

    local ok, started = pcall(job.run, done, job)
    if not ok then
        if job.on_error then
            pcall(job.on_error, started)
        end
        done()
        return
    end
    if job.async and started == false then
        done()
    elseif not job.async then
        done()
    end
end

function SyncCoordinator:submit(job)
    assert(type(job) == "table", "sync job must be a table")
    assert(type(job.family) == "string" and job.family ~= "", "sync job family required")
    assert(type(job.run) == "function", "sync job run function required")

    self.next_seq = self.next_seq + 1
    job.seq = self.next_seq
    job.created_at = self.now()
    job.priority = job.priority or SyncCoordinator.PRIORITY.auto
    job.label = job.label or job.family

    if self.current then
        return self:coalesce(job)
    end

    self:start(job)
    return "started", job
end

function SyncCoordinator:status()
    local now = self.now()
    local _, next_job = self:nextPending()
    return {
        current = copyJobStatus(self.current, now),
        pending_count = self.pending_count,
        next = copyJobStatus(next_job, now),
    }
end

return SyncCoordinator
