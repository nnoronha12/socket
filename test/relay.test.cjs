const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { io } = require('socket.io-client');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if (await check()) return; } catch {}
    await pause(30);
  }
  throw new Error('Timed out waiting for relay');
}

test('webhook delivery respects joined and left rooms', { timeout: 15000 }, async t => {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
    env: { ...process.env, PORT: String(port) }, stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  });
  const origin = `http://127.0.0.1:${port}`;
  await until(async () => (await fetch(origin + '/health')).ok);
  const root = await (await fetch(origin)).json();
  assert.equal(root.endpoints.webhook, '/webhook');
  assert.equal((await fetch(origin + '/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })).status, 400);

  const first = io(origin, { autoConnect: false, reconnection: false });
  const second = io(origin, { autoConnect: false, reconnection: false });
  t.after(() => { first.disconnect(); second.disconnect(); });
  const connected = Promise.all([once(first, 'connect'), once(second, 'connect')]);
  first.connect(); second.connect(); await connected;
  const firstMessages = [], secondMessages = [];
  first.on('n8n_response', data => firstMessages.push(data));
  second.on('n8n_response', data => secondMessages.push(data));
  first.emit('join', { sessionId: 'synthetic-room-a' });
  second.emit('join', { sessionId: 'synthetic-room-b' });
  const health = async () => (await (await fetch(origin + '/health')).json());
  await until(async () => (await health()).connectedClients === 2);
  const message = { output: 'Synthetic relay check', sessionDetails: { sessionId: 'synthetic-room-a', chatLock: false } };
  const post = () => fetch(origin + '/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message),
  });
  assert.equal((await post()).status, 200);
  await until(() => firstMessages.length === 1);
  assert.deepEqual(firstMessages[0], message);
  await pause(150);
  assert.deepEqual(secondMessages, []);
  first.emit('leave', { sessionId: 'synthetic-room-a' });
  await until(async () => !(await health()).sessions.includes('synthetic-room-a'));
  assert.equal((await post()).status, 200);
  await pause(150);
  assert.equal(firstMessages.length, 1);
  assert.equal(secondMessages.length, 0);
});
