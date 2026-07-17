local Trapper = require("ui/trapper")
local logger = require("logger")

local SyncJobRunner = {}

function SyncJobRunner.prepare(job)
    local original_run = job.run
    local original_async = job.async == true

    job.async = true
    job.run = function(done, submitted_job)
        Trapper:wrap(function()
            local ok, err = xpcall(function()
                if original_async then
                    original_run(done, submitted_job)
                else
                    original_run(done, submitted_job)
                    done()
                end
            end, debug.traceback)
            if not ok then
                logger.err("BookOrbit: sync job failed:", err)
                done()
            end
        end)
        return true
    end

    return job
end

return SyncJobRunner
