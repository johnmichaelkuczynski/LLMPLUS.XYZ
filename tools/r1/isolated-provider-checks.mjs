// Loaded only in the fixture subprocess, never in the app or the R1 browser.
import net from 'node:net';

const blocked = () => { throw new Error('Credential fixtures must not access the network'); };
globalThis.fetch = blocked;
net.Socket.prototype.connect = blocked;
