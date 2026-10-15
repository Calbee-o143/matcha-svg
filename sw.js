// what gets blocked, split so the stats can count ads and trackers separately.
// a pattern with a path only matches that path on that host
const ADBLOCK_PATTERNS = [
    "googlesyndication.com",
    "googleadservices.com",
    "doubleclick.net",
    "adnxs.com",
    "amazon-adsystem.com",
    "rubiconproject.com",
    "pubmatic.com",
    "criteo.com",
    "openx.net",
    "taboola.com",
    "outbrain.com",
    "moatads.com",
    "casalemedia.com",
    "adsafeprotected.com",
    "advertising.com",
    "adtechus.com",
    "unityads.unity3d.com",
    "facebook.com/ads",
    "ads-api.twitter.com",
    "youtube.com/api/stats/ads",
    "youtube.com/pagead",
    "youtube.com/get_midroll",
];
const TRACKER_PATTERNS = [
    "google-analytics.com",
    "googletagmanager.com",
    "chartbeat.com",
    "scorecardresearch.com",
    "quantserve.com",
    "krxd.net",
    "demdex.net",
    "hotjar.com",
    "mixpanel.com",
    "api.amplitude.com",
    "fullstory.com",
    "clarity.ms",
    "nr-data.net",
    "bat.bing.com",
    "analytics.tiktok.com",
    "ct.pinterest.com",
    "facebook.com/tr",
    "graph.facebook.com/pixel",
    "analytics.twitter.com",
];

// returns "ad", "tracker" or null
function blockKind(urlStr) {
    let h; try { h = new URL(urlStr).hostname; } catch { return null; }
    const hit = p => { const d = p.split('/')[0]; return (h === d || h.endsWith('.' + d)) && (!p.includes('/') || urlStr.includes(p)); };
    return ADBLOCK_PATTERNS.some(hit) ? "ad" : TRACKER_PATTERNS.some(hit) ? "tracker" : null;
}

const swPath = self.location.pathname;
const basePath = swPath.substring(0, swPath.lastIndexOf('/') + 1);
self.basePath = basePath;
 
self.$scramjet = {
    files: {
        wasm: basePath + "p/js/homework/math.wasm.wasm",
        sync: basePath + "p/js/homework/math.sync.js",
    }
};
 
importScripts(basePath + "p/js/homework/math.all.js");
importScripts(basePath + "p/js/lib/bare-mux.js");

// ultraviolet. uv.config.js isn't a real file, the fetch handler below serves it
const UV_FILES = {
    handler: basePath + "p/js/homework/uv.handler.js",
    client: basePath + "p/js/homework/uv.client.js",
    bundle: basePath + "p/js/homework/uv.bundle.js",
    config: basePath + "p/js/homework/uv.config.js",
    sw: basePath + "p/js/homework/uv.sw.js"
};

let uv = null;
let UV_CONFIG_SOURCE = "";
try {
    importScripts(UV_FILES.bundle);
    self.__uv$config = {
        prefix: basePath + "uv/",
        encodeUrl: Ultraviolet.codec.xor.encode,
        decodeUrl: Ultraviolet.codec.xor.decode,
        ...UV_FILES
    };
    importScripts(UV_FILES.sw);
    uv = new UVServiceWorker();
    UV_CONFIG_SOURCE = "self.__uv$config=" + JSON.stringify({ prefix: self.__uv$config.prefix, ...UV_FILES }) + ";self.__uv$config.encodeUrl=Ultraviolet.codec.xor.encode;self.__uv$config.decodeUrl=Ultraviolet.codec.xor.decode;";
} catch {}
 
const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker({
    prefix: basePath + "scramjet/"
});
 
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
 
let wispConfig = { wispurl: null, servers: [], autoswitch: true };
 
async function pingServer(url) {
    return new Promise(resolve => {
        const start = Date.now();
        try {
            const ws = new WebSocket(url);
            const t = setTimeout(() => { try { ws.close(); } catch {} resolve({ url, success: false, latency: null }); }, 3000);
            ws.onopen = () => { clearTimeout(t); try { ws.close(); } catch {} resolve({ url, success: true, latency: Date.now() - start }); };
            ws.onerror = () => { clearTimeout(t); resolve({ url, success: false, latency: null }); };
        } catch { resolve({ url, success: false, latency: null }); }
    });
}
 
// proxied requests come in as /scramjet/<url> or /uv/<url>, so decode them to see where they really go
function realUrl(req) {
    try {
        const u = new URL(req.url);
        if (u.origin !== self.location.origin) return req.url;
        const sj = basePath + "scramjet/", up = basePath + "uv/";
        if (u.pathname.startsWith(sj)) return decodeURIComponent(u.pathname.slice(sj.length)) + u.search;
        if (uv && u.pathname.startsWith(up)) return self.__uv$config.decodeUrl(u.pathname.slice(up.length)) + u.search;
    } catch {}
    return req.url;
}

// block counts are batched and sent to one mochii window, which keeps the totals in localStorage
let pendingBlocks = null, blockFlush = 0;
function countBlock(kind, url) {
    let host = ""; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    pendingBlocks = pendingBlocks || { ads: 0, trackers: 0, hosts: {} };
    pendingBlocks[kind === "ad" ? "ads" : "trackers"]++;
    if (host) pendingBlocks.hosts[host] = (pendingBlocks.hosts[host] || 0) + 1;
    if (!blockFlush) blockFlush = setTimeout(flushBlocks, 1500);
}
async function flushBlocks() {
    blockFlush = 0;
    if (!pendingBlocks) return;
    const tops = (await self.clients.matchAll({ type: "window" })).filter(c => c.frameType === "top-level" && /\/(index\.html)?$/.test(new URL(c.url).pathname));
    const target = tops.find(c => c.focused) || tops[0];
    if (!target) return; // kept for the next flush
    target.postMessage({ type: "blocked", ...pendingBlocks });
    pendingBlocks = null;
}

function notifyClients(msg) {
    self.clients.matchAll().then(clients => clients.forEach(c => c.postMessage(msg)));
}
 
async function proactiveCheck() {
    if (!wispConfig.autoswitch || !wispConfig.servers?.length) return;
    const results = await Promise.all(wispConfig.servers.map(s => pingServer(s.url)));
    const currentOk = results.find(r => r.url === wispConfig.wispurl)?.success;
    if (!currentOk) {
        const best = results.filter(r => r.success).sort((a,b) => a.latency - b.latency)[0];
        if (best) {
            wispConfig.wispurl = best.url;
            notifyClients({ type: 'wispChanged', url: best.url, name: wispConfig.servers.find(s => s.url === best.url)?.name || 'Server', latency: best.latency });
        }
    }
}
 
self.addEventListener("message", ({ data }) => {
    if (data?.type === "config") {
        if (data.wispurl) wispConfig.wispurl = data.wispurl;
        if (data.servers?.length) { wispConfig.servers = data.servers; if (wispConfig.autoswitch) setTimeout(proactiveCheck, 500); }
        if (typeof data.autoswitch !== 'undefined') wispConfig.autoswitch = data.autoswitch;
    } else if (data?.type === "ping") {
        pingServer(wispConfig.wispurl).then(result => notifyClients({ type: 'pingResult', ...result }));
    }
});
 
self.addEventListener("fetch", event => {
    const real = realUrl(event.request), kind = blockKind(real);
    if (kind) {
        countBlock(kind, real);
        event.respondWith(new Response(null, { status: 204 }));
        return;
    }
    if (uv && new URL(event.request.url).pathname === UV_FILES.config) {
        event.respondWith(new Response(UV_CONFIG_SOURCE, { headers: { "Content-Type": "text/javascript", "Cache-Control": "no-store" } }));
        return;
    }
    if (uv && uv.route(event)) {
        event.respondWith(uv.fetch(event));
        return;
    }
    event.respondWith((async () => {
        try {
            await scramjet.loadConfig();
            if (scramjet.route(event)) return scramjet.fetch(event);
        } catch {}
        return fetch(event.request);
    })());
});
