local Proxy = {}

local function proxyConfig(proxy_url)
    if type(proxy_url) ~= "string" or proxy_url:find("[\r\n]") then return nil end
    local url = require("socket.url")
    local parsed = url.parse(proxy_url)
    local port = parsed and tonumber(parsed.port or 3128)
    if not parsed or parsed.scheme ~= "http" or not parsed.host
            or not port or port < 1 or port > 65535 or port ~= math.floor(port) then
        return nil
    end

    local authorization = ""
    if parsed.user and parsed.password then
        local user = url.unescape(parsed.user)
        local password = url.unescape(parsed.password)
        if user:find("[\r\n]") or password:find("[\r\n]") then return nil end
        authorization = "Proxy-Authorization: Basic "
            .. require("mime").b64(user .. ":" .. password) .. "\r\n"
    end

    return {
        host = parsed.host:match("^%[(.*)%]$") or parsed.host,
        port = port,
        authorization = authorization,
    }
end

local function readLine(sock, remaining)
    local chars = {}
    for _ = 1, remaining do
        local char, err = sock:receive(1)
        if not char then return nil, err end
        if char == "\n" then
            if chars[#chars] == "\r" then chars[#chars] = nil end
            return table.concat(chars)
        end
        chars[#chars + 1] = char
    end
    return nil, "proxy_response_too_large"
end

function Proxy.connectSocket(proxy_url)
    return function()
        local config = proxyConfig(proxy_url)
        if not config then error("invalid_http_proxy") end

        local socket = require("socket")
        local conn = { sock = assert(socket.tcp()) }
        function conn:settimeout(...)
            return self.sock:settimeout(...)
        end
        function conn:close()
            return self.sock:close()
        end
        function conn:connect(host, port)
            local target_port = tonumber(port)
            if type(host) ~= "string" or host:find("[%c%s]")
                    or not target_port or target_port < 1 or target_port > 65535
                    or target_port ~= math.floor(target_port) then
                return nil, "invalid_https_target"
            end
            local connected, connect_err = self.sock:connect(config.host, config.port)
            if not connected then return nil, connect_err end
            local tls_host = host:match("^%[(.*)%]$") or host
            local authority = tls_host:find(":", 1, true)
                and "[" .. tls_host .. "]:" .. tostring(target_port)
                or tls_host .. ":" .. tostring(target_port)
            local sent, send_err = self.sock:send("CONNECT " .. authority .. " HTTP/1.1\r\nHost: "
                .. authority .. "\r\n" .. config.authorization .. "\r\n")
            if not sent then return nil, send_err end

            local status, status_err = readLine(self.sock, 8192)
            if not status then return nil, status_err end
            if status:match("^HTTP/%d+%.%d+%s+(%d%d%d)") ~= "200" then
                return nil, "proxy_connect_failed"
            end
            local header_bytes = #status + 2
            local headers_complete = false
            for _ = 1, 64 do
                local line, line_err = readLine(self.sock, 8192 - header_bytes)
                if not line then return nil, line_err end
                header_bytes = header_bytes + #line + 2
                if header_bytes > 8192 then return nil, "proxy_response_too_large" end
                if line == "" then
                    headers_complete = true
                    break
                end
            end
            if not headers_complete then return nil, "proxy_response_too_large" end

            -- Keep the same TLS policy as KOReader's LuaSec HTTPS transport.
            local tls, tls_err = require("ssl").wrap(self.sock, {
                protocol = "any",
                options = { "all", "no_sslv2", "no_sslv3", "no_tlsv1" },
                verify = "none",
                mode = "client",
            })
            if not tls then return nil, tls_err end
            tls:sni(tls_host)
            tls:settimeout(require("ssl.https").TIMEOUT)
            self.sock = tls
            local handshook, handshake_err = tls:dohandshake()
            if not handshook then return nil, handshake_err end
            for name, method in pairs(getmetatable(tls).__index) do
                if type(method) == "function" then
                    self[name] = function(_, ...)
                        return method(self.sock, ...)
                    end
                end
            end
            return 1
        end
        return conn
    end
end

return Proxy
