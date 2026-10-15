// the bare-mux transport: libcurl, but some hosts connect through another address.
// some wisp servers can't reach the google ips www.youtube.com resolves to (the connection just hangs),
// while m.youtube.com lands on the same google front end at a reachable ip. only the wisp CONNECT
// hostname changes: tls (sni + cert check) and the Host header still say www.youtube.com
import LibcurlClient from './lib/libcurl-transport.mjs';

import './alias.mjs';
export default LibcurlClient;
