local FakeScheduler = {}
FakeScheduler.__index = FakeScheduler

function FakeScheduler.new()
    return setmetatable({
        now = 0,
        next_id = 0,
        pending = {},
    }, FakeScheduler)
end

function FakeScheduler:scheduleIn(delay, callback)
    self.next_id = self.next_id + 1
    table.insert(self.pending, {
        id = self.next_id,
        at = self.now + delay,
        callback = callback,
    })
    return self.next_id
end

function FakeScheduler:nextTick(callback)
    return self:scheduleIn(0, callback)
end

function FakeScheduler:pendingCount()
    return #self.pending
end

function FakeScheduler:runOne()
    table.sort(self.pending, function(a, b)
        if a.at == b.at then return a.id < b.id end
        return a.at < b.at
    end)
    local task = table.remove(self.pending, 1)
    if not task then return false end
    self.now = task.at
    task.callback()
    return true
end

function FakeScheduler:advance(seconds)
    local target = self.now + seconds
    while true do
        table.sort(self.pending, function(a, b)
            if a.at == b.at then return a.id < b.id end
            return a.at < b.at
        end)
        if not self.pending[1] or self.pending[1].at > target then break end
        self:runOne()
    end
    self.now = target
end

function FakeScheduler:drain()
    while self:runOne() do end
end

return FakeScheduler
