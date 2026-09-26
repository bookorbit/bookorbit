local url = {
    parse = function(value)
        local scheme, rest = value:match("^(%w+)://(.+)$")
        if not scheme then return nil end
        local credentials = rest:match("^([^@]+)@")
        if credentials then rest = rest:sub(#credentials + 2) end
        local host, port = rest:match("^([^:]+):(%d+)$")
        return {
            scheme = scheme,
            host = host,
            port = port,
            user = credentials and credentials:match("^([^:]+):"),
            password = credentials and credentials:match(":(.+)$"),
        }
    end,
    unescape = function(value) return value end,
}
local mime = { b64 = function() return "encoded-credentials" end }

local response
local raw
local tls
package.loaded["socket"] = {
    tcp = function()
        raw = { sent = "", position = 1 }
        function raw:settimeout(value)
            self.timeout = value
            return 1
        end
        function raw:connect(host, port)
            self.host, self.port = host, port
            return 1
        end
        function raw:send(value)
            self.sent = self.sent .. value
            return #value
        end
        function raw:receive()
            if self.position > #response then return nil, "closed" end
            local char = response:sub(self.position, self.position)
            self.position = self.position + 1
            return char
        end
        function raw:close() return 1 end
        return raw
    end,
}
package.loaded["socket.url"] = url
package.loaded["mime"] = mime
package.loaded["ssl.https"] = { TIMEOUT = 10 }
package.loaded["ssl"] = {
    wrap = function()
        tls = setmetatable({}, { __index = {
            sni = function(self, host) self.host = host end,
            settimeout = function(self, value) self.timeout = value end,
            dohandshake = function() return 1 end,
            send = function() return 1 end,
            receive = function() return "ok" end,
            close = function() return 1 end,
        } })
        return tls
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
local Proxy = require("bookorbit_proxy")

local function assertEqual(actual, expected, label)
    if actual ~= expected then error(label .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual)) end
end

response = "HTTP/1.1 200 Connection Established\r\nProxy-Agent: test\r\n\r\n"
local conn = Proxy.connectSocket("http://reader:password@127.0.0.1:3128")()
conn:settimeout(10)
assertEqual(conn:connect("books.example", 443), 1, "CONNECT succeeds")
assertEqual(raw.host, "127.0.0.1", "connects to proxy host")
assertEqual(raw.port, 3128, "connects to proxy port")
assertEqual(raw.sent:match("^CONNECT books%.example:443 HTTP/1%.1"),
    "CONNECT books.example:443 HTTP/1.1", "sends tunnel request")
assertEqual(raw.sent:find("Proxy-Authorization: Basic ", 1, true) ~= nil, true,
    "sends proxy credentials only in tunnel request")
assertEqual(raw.sent:find("x-auth-key", 1, true), nil, "never sends BookOrbit credentials in CONNECT")
assertEqual(tls.host, "books.example", "uses target host for TLS SNI")
assertEqual(tls.timeout, 10, "sets TLS timeout")
assertEqual(conn:receive(), "ok", "forwards socket methods to TLS")

response = "HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"
conn = Proxy.connectSocket("http://127.0.0.1:3128")()
local success, err = conn:connect("books.example", 443)
assertEqual(success, nil, "rejects failed CONNECT")
assertEqual(err, "proxy_connect_failed", "reports failed CONNECT")
assertEqual(raw.sent:find("Proxy-Authorization", 1, true), nil,
    "does not invent a proxy authorization header")

response = "HTTP/1.1 200 Connection Established\r\nX-Large: " .. string.rep("x", 8192)
conn = Proxy.connectSocket("http://127.0.0.1:3128")()
success, err = conn:connect("books.example", 443)
assertEqual(success, nil, "rejects oversized proxy response")
assertEqual(err, "proxy_response_too_large", "bounds proxy headers")

print("bookorbit_proxy_test.lua: ok")
