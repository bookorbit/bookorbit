package.path = 'koreader-plugin/bookorbit.koplugin/?.lua;' .. package.path
package.preload.gettext = function() return function(text) return text end end
local Delivery = require('bookorbit_delivery')
local Capabilities = require('bookorbit_capabilities')
local settings = {}
local client = { server_url = 'https://books.example.com/api/v1', username = 'reader' }
function client:getPluginVersion() return { capabilities = { 'readAloudDeliveryVariants' } } end
assert(Delivery.resolve(settings, client) == 'audioless_epub')
Delivery.set(settings, client, 'original')
assert(Delivery.resolve(settings, client) == 'original')
assert(Delivery.resolve(settings, client, 'audioless_epub') == 'audioless_epub')
Delivery.set(settings, client, 'audioless_epub')
assert(Delivery.resolve(settings, client, 'original') == 'original')
Delivery.set(settings, client, 'original')
local another = { server_url = client.server_url, username = 'another-reader', getPluginVersion = client.getPluginVersion }
assert(Delivery.preference(settings, another) == 'audioless_epub')
local other_server = { server_url = 'https://other.example.com/api/v1', username = client.username, getPluginVersion = client.getPluginVersion }
assert(Delivery.preference(settings, other_server) == 'audioless_epub')
Capabilities.remember(client, { capabilities = {} })
local variant, err = Delivery.resolve(settings, client)
assert(variant == nil and err ~= nil)
assert(Delivery.preference(settings, client) == 'original')
Delivery.set(settings, client, 'audioless_epub')
variant, err = Delivery.resolve(settings, client)
assert(variant == nil and err == nil)
variant, err = Delivery.resolve(settings, client, 'audioless_epub')
assert(variant == nil and err ~= nil)
Capabilities.reset()
function client:getPluginVersion() return nil, 503 end
Delivery.set(settings, client, 'original')
variant, err = Delivery.resolve(settings, client)
assert(variant == nil and err ~= nil)
assert(Capabilities.cached(client) == nil)
function client:getPluginVersion() return { capabilities = { 'readAloudDeliveryVariants' } } end
assert(Delivery.resolve(settings, client) == 'original')
Capabilities.markUnsupported(client, 'readAloudDeliveryVariants')
variant, err = Delivery.resolve(settings, client)
assert(variant == nil and err ~= nil)
print('bookorbit_delivery_test.lua: ok')

Capabilities.reset()
local central = { server_url = client.server_url, username = 'central-reader', device_id = 'device-a' }
function central:getPluginVersion() return { capabilities = { 'readAloudDeliveryVariants', 'readAloudDeliverySettings' } } end
local server = { readAloudDelivery = 'audioless_epub', deviceConfigured = false }
local updates = {}
function central:getDeliverySettings() return server end
function central:setDeliverySettings(value, migrate)
    updates[#updates+1] = { value = value, migrate = migrate }
    if not migrate or not server.deviceConfigured then
        server = { readAloudDelivery = value or server.credentialDefault or 'audioless_epub', deviceOverride = value,
            credentialDefault = server.credentialDefault, deviceConfigured = true }
    end
    return server
end
Delivery.set(settings, central, 'original')
assert(Delivery.resolve(settings, central) == 'original')
assert(updates[1].migrate == true and updates[1].value == 'original')
server = { readAloudDelivery = 'audioless_epub', deviceConfigured = true, credentialDefault = 'audioless_epub' }
assert(Delivery.resolve(settings, central) == 'audioless_epub')
assert(#updates == 1)
assert(Delivery.resolve(settings, central, 'original') == 'original')
assert(Delivery.update(settings, central, 'original') == 'original')
assert(updates[2].migrate == false)
assert(Delivery.update(settings, central, nil) == 'audioless_epub')
server = nil
variant, err = Delivery.resolve(settings, central)
assert(variant == nil and err ~= nil)
assert(Delivery.errorText(err) == "Could not load the EPUB delivery default from BookOrbit. Reconnect and retry, or choose a variant for this download.")
assert(Delivery.resolve(settings, central, 'original') == 'original')
server = { readAloudDelivery = 'future-value', deviceConfigured = true }
variant, err = Delivery.resolve(settings, central)
assert(variant == nil and err ~= nil)
assert(Delivery.errorText(err) == "The server returned an invalid EPUB delivery preference. Reconnect and retry.")
assert(Delivery.errorText("untrusted upstream response") == nil)
assert(Delivery.errorText(503) == nil)
assert(Delivery.errorText(nil) == nil)
print('central delivery settings: ok')
server = { readAloudDelivery = 'original', deviceConfigured = true }
assert(Delivery.resolve(settings, central) == 'original')
local restarted = { server_url = central.server_url, username = central.username, getPluginVersion = client.getPluginVersion }
Capabilities.remember(restarted, { capabilities = { 'readAloudDeliveryVariants' } })
assert(Delivery.resolve(settings, restarted) == 'original')
Capabilities.remember(restarted, { capabilities = {} })
variant, err = Delivery.resolve(settings, restarted)
assert(variant == nil and err ~= nil)
assert(Delivery.errorText(err) == "This server cannot confirm support for the requested EPUB variant. Reconnect to a compatible server and retry.")
assert(Delivery.preference(settings, restarted) == 'original')
print('central preference survives a server downgrade: ok')
