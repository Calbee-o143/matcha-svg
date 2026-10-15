// the host alias patch shared by both bare-mux transports (libcurl and epoxy), see transport.mjs
const HOST_ALIASES = { 'www.youtube.com': 'm.youtube.com' };

// this runs in the bare-mux worker, where the only sockets are libcurl's wisp ones. patching send on the
// prototype also covers a wisp socket that was opened before this module loaded (the worker outlives reloads).
// a wisp CONNECT packet is [type 1][stream id x4][stream type][port x2][hostname]
const proto = globalThis.WebSocket.prototype;
if (!proto.__mochiiSend) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  proto.__mochiiSend = proto.send;
  proto.send = function (data) {
    const p = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    if (p instanceof Uint8Array && p[0] === 1 && p.length > 8) {
      const alias = HOST_ALIASES[dec.decode(p.subarray(8)).toLowerCase()];
      if (alias) { const h = enc.encode(alias); data = new Uint8Array(8 + h.length); data.set(p.subarray(0, 8)); data.set(h, 8); }
    }
    return this.__mochiiSend(data);
  };
}
