"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_http_1 = require("node:http");
const PORT = Number(process.env.PORT ?? 8080);
const server = (0, node_http_1.createServer)((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
});
server.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}`);
});
//# sourceMappingURL=index.js.map