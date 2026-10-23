local Capabilities = require("bookorbit_capabilities")
local _ = require("gettext")
local Delivery = {}

local errors = {
    invalid = _("The server returned an invalid EPUB delivery preference. Reconnect and retry."),
    load = _("Could not load the EPUB delivery default from BookOrbit. Reconnect and retry, or choose a variant for this download."),
    migrate = _("Could not migrate the EPUB delivery preference to BookOrbit. Reconnect and retry."),
    unsupported = _("This server cannot confirm support for the requested EPUB variant. Reconnect to a compatible server and retry."),
    save = _("Could not save the EPUB delivery preference in BookOrbit. Reconnect and retry."),
    default = _("This server does not support a server default. Update BookOrbit first."),
}

function Delivery.errorText(err)
    for _, message in pairs(errors) do
        if err == message then return message end
    end
end

local function validVariant(value)
    return value == "original" or value == "audioless_epub"
end

function Delivery.key(client)
    return tostring(client.server_url) .. "|" .. tostring(client.username)
end

local function legacyPreference(settings, client)
    return (settings.catalog_delivery_profiles or {})[Delivery.key(client)]
end

function Delivery.preference(settings, client)
    local cached = client.delivery_settings
    if cached and cached.key == Delivery.key(client) then return cached.readAloudDelivery end
    local remote = (settings.catalog_delivery_server_profiles or {})[Delivery.key(client)]
    if validVariant(remote) then return remote end
    return legacyPreference(settings, client) == "original" and "original" or "audioless_epub"
end

local function remember(settings, client, body)
    if type(body) ~= "table" or not validVariant(body.readAloudDelivery) then
        return nil, errors.invalid
    end
    local profiles = settings.catalog_delivery_server_profiles or {}
    profiles[Delivery.key(client)] = body.readAloudDelivery
    settings.catalog_delivery_server_profiles = profiles
    client.delivery_settings = {
        key = Delivery.key(client), readAloudDelivery = body.readAloudDelivery,
        credentialDefault = body.credentialDefault, deviceOverride = body.deviceOverride,
    }
    return body.readAloudDelivery
end

function Delivery.refresh(settings, client)
    local body = client:getDeliverySettings()
    if not body then return nil, errors.load end
    if type(body) ~= "table" or not validVariant(body.readAloudDelivery) then return remember(settings, client, body) end
    if body.deviceConfigured == false then
        local legacy = legacyPreference(settings, client)
        body = client:setDeliverySettings(validVariant(legacy) and legacy or nil, true)
        if not body then return nil, errors.migrate end
    end
    return remember(settings, client, body)
end

function Delivery.resolve(settings, client, override)
    local supported = client.getPluginVersion and Capabilities.supports(client, "readAloudDeliveryVariants")
    if supported then
        if override then return override end
        if Capabilities.supports(client, "readAloudDeliverySettings") then return Delivery.refresh(settings, client) end
        return Delivery.preference(settings, client)
    end
    local requested = override or Delivery.preference(settings, client)
    if requested == "original" or override then
        return nil, errors.unsupported
    end
    return nil
end

function Delivery.update(settings, client, variant)
    if client.getPluginVersion and Capabilities.supports(client, "readAloudDeliverySettings") then
        local body = client:setDeliverySettings(variant, false)
        if not body then return nil, errors.save end
        return remember(settings, client, body)
    end
    if not variant then return nil, errors.default end
    local resolved, err = Delivery.resolve(settings, client, variant)
    if err then return nil, err end
    Delivery.set(settings, client, resolved)
    return resolved
end

function Delivery.set(settings, client, variant)
    local profiles = settings.catalog_delivery_profiles or {}
    profiles[Delivery.key(client)] = variant
    settings.catalog_delivery_profiles = profiles
    return profiles
end

return Delivery
