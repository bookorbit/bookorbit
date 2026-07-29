--[[--
Server capability detection for wire features the plugin can only use when the
server advertises them.

Plugin and server versions ship independently, so a new route is selected only
after the server names it. Detection is cached per server URL and login for the
plugin session, and re-checked when the server version changes.

A downgrade is recorded only for a confirmed answer. Timeouts, 5xx responses
and authentication failures leave the capability unknown, so a transient
problem never parks the plugin on the legacy path for the rest of the session.
]]

local Capabilities = {}

local cache

local function cacheKey(client)
    return tostring(client and client.server_url) .. "|" .. tostring(client and client.username)
end

local function isTransient(err)
    if err == nil then return true end
    if type(err) == "number" then
        -- 4xx is a definitive answer from a server that understood us; 5xx and
        -- transport failures are not.
        return err >= 500
    end
    return true
end

function Capabilities.reset()
    cache = nil
end

-- Returns the cached capability list for this client, or nil when unknown.
function Capabilities.cached(client)
    if cache and cache.key == cacheKey(client) then return cache.capabilities end
    return nil
end

function Capabilities.remember(client, body)
    local names = {}
    for _, name in ipairs((body or {}).capabilities or {}) do
        if type(name) == "string" then names[name] = true end
    end
    cache = {
        key = cacheKey(client),
        capabilities = names,
        server_version = body and body.serverVersion or nil,
    }
    return names
end

-- Returns true when the feature is advertised, false when the server answered
-- without it, and nil when the answer is still unknown.
function Capabilities.supports(client, feature)
    local known = Capabilities.cached(client)
    if known then return known[feature] == true end

    local body, err = client:getPluginVersion()
    if not body then
        if isTransient(err) then return nil end
        Capabilities.remember(client, {})
        return false
    end
    return Capabilities.remember(client, body)[feature] == true
end

-- Records a confirmed unsupported response observed on the feature's own
-- route, so a 404 from an older server downgrades immediately.
function Capabilities.markUnsupported(client, feature)
    local known = Capabilities.cached(client)
    if not known then
        known = {}
        cache = { key = cacheKey(client), capabilities = known }
    end
    known[feature] = false
end

return Capabilities
