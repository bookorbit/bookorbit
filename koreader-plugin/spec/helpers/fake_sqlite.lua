-- Deterministic stand-in for lua-ljsqlite3, covering the subset the plugin
-- uses: open, set_busy_timeout, prepare, reset, bind, resultset and close.
-- Counters let a test assert how many connections and queries a phase really
-- performed, which is the point of the sweep's shared statistics session.

local FakeSqlite = {}

-- ljsqlite3 hands back column-major arrays, so tests declare readable rows and
-- this converts them.
function FakeSqlite.resultSet(rows)
    if not rows or #rows == 0 then return nil end
    local columns = {}
    for index = 1, #rows[1] do
        local column = {}
        for row_index, row in ipairs(rows) do
            column[row_index] = row[index]
        end
        columns[index] = column
    end
    return columns
end

--[[--
Installs the fake as `lua-ljsqlite3/init` and returns its counters.

`respond(sql, params)` answers one query and returns a column-major result set
(see resultSet) or nil for "no rows". `opts.fail_opens` makes that many opens
fail, and `opts.fail_queries` that many queries error, so reopen-and-retry can
be exercised.
]]
function FakeSqlite.install(respond, opts)
    opts = opts or {}
    local stats = { opens = 0, closes = 0, prepares = 0, queries = 0 }
    local failed_opens, failed_queries = 0, 0

    package.loaded["lua-ljsqlite3/init"] = {
        open = function()
            stats.opens = stats.opens + 1
            if failed_opens < (opts.fail_opens or 0) then
                failed_opens = failed_opens + 1
                error("fake sqlite open failure")
            end
            local conn = {}
            function conn:set_busy_timeout() end
            function conn:prepare(sql)
                stats.prepares = stats.prepares + 1
                local stmt = { params = {} }
                function stmt:reset()
                    self.params = {}
                    return self
                end
                function stmt:bind(...)
                    self.params = { ... }
                    return self
                end
                function stmt:resultset()
                    stats.queries = stats.queries + 1
                    if failed_queries < (opts.fail_queries or 0) then
                        failed_queries = failed_queries + 1
                        error("fake sqlite query failure")
                    end
                    return respond(sql, self.params)
                end
                function stmt:close() end
                return stmt
            end
            function conn:close()
                stats.closes = stats.closes + 1
            end
            return conn
        end,
    }
    return stats
end

return FakeSqlite
