local OpenAnnotationScheduler = {}
OpenAnnotationScheduler.__index = OpenAnnotationScheduler

function OpenAnnotationScheduler.new(opts)
    opts = opts or {}
    return setmetatable({
        delay = opts.delay or 2,
        schedule_in = opts.schedule_in,
        token = 0,
        pending = nil,
    }, OpenAnnotationScheduler)
end

function OpenAnnotationScheduler:clear(token)
    if self.pending and self.pending.token == token then
        self.pending = nil
    end
end

function OpenAnnotationScheduler:schedule(plugin, digest, reason, opts)
    if not digest or digest == "" then return false end
    opts = opts or {}
    self.token = self.token + 1
    local token = self.token
    self.pending = {
        token = token,
        digest = digest,
        reason = reason or "annotation_open",
        match_retried = opts.match_retried == true,
        phase = "scheduled",
    }

    self.schedule_in(self.delay, function()
        self:run(plugin, token)
    end)
    return true
end

function OpenAnnotationScheduler:recordUnmatched(plugin, reason)
    if plugin.recordOpenAnnotationUnmatched then
        plugin:recordOpenAnnotationUnmatched(reason)
    end
end

function OpenAnnotationScheduler:bookStillOpen(plugin, digest)
    return not plugin.getDocumentDigest or plugin:getDocumentDigest() == digest
end

function OpenAnnotationScheduler:run(plugin, token)
    local pending = self.pending
    if not pending or pending.token ~= token then return end

    local digest = pending.digest
    local reason = pending.reason
    if not self:bookStillOpen(plugin, digest) then
        self:clear(token)
        return
    end
    if plugin.shouldSkipAutoSyncOffline and plugin:shouldSkipAutoSyncOffline(reason) then
        self:clear(token)
        return
    end
    if plugin.isOpenBookMatched and plugin:isOpenBookMatched(digest) then
        self:clear(token)
        plugin:requestAnnotationExchange(reason)
        return
    end
    if pending.match_retried or not plugin.matchOpenBookForAutoSync then
        self:clear(token)
        self:recordUnmatched(plugin, reason)
        return
    end

    pending.phase = "matching"
    plugin:matchOpenBookForAutoSync(function(matched)
        local current = self.pending
        if not current or current.token ~= token then return end
        if not self:bookStillOpen(plugin, digest) then
            self:clear(token)
            return
        end
        self:clear(token)
        if matched then
            self:schedule(plugin, digest, reason, { match_retried = true })
        else
            self:recordUnmatched(plugin, reason)
        end
    end)
end

function OpenAnnotationScheduler:status()
    return self.pending
end

return OpenAnnotationScheduler
