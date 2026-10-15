// the bare-mux transport: epoxy (end to end encrypted over wisp), with the same host aliases as transport.mjs
import EpoxyClient from './lib/epoxy-transport.mjs';
import './alias.mjs';

export default EpoxyClient;
