const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const config = require('./config');
const store = require('./store');
const { RoomManager } = require('./roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const roomManager = new RoomManager(io, store.load());

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/qr/:code', async (req, res) => {
  const room = roomManager.getRoom(req.params.code);
  if (!room) return res.status(404).end();
  const host = req.headers.host;
  const joinUrl = `${req.protocol}://${host}/?code=${encodeURIComponent(room.code)}`;
  res.type('png');
  QRCode.toFileStream(res, joinUrl, { width: 320, margin: 1 });
});

function persist() {
  roomManager.persist(store);
}

io.on('connection', (socket) => {
  socket.on('player:hostNewGame', (payload, ack) => {
    const { room, player, error } = roomManager.hostNewGame(payload?.name, socket.id);
    if (error) return ack?.({ ok: false, error });
    persist();
    ack?.({ ok: true, code: room.code, playerId: player.id, state: roomManager.playerView(room, player.id) });
  });

  socket.on('player:join', (payload, ack) => {
    const { room, player, error, resumed } = roomManager.joinPlayer(
      payload?.code,
      { name: payload?.name, playerId: payload?.playerId },
      socket.id
    );
    if (error) return ack?.({ ok: false, error });
    persist();
    roomManager.broadcast(room);
    ack?.({ ok: true, playerId: player.id, resumed, state: roomManager.playerView(room, player.id) });
  });

  socket.on('player:startGame', (payload, ack) => {
    const { error } = roomManager.startGame(payload?.code, payload?.playerId);
    if (error) return ack?.({ ok: false, error });
    persist();
    ack?.({ ok: true });
  });

  socket.on('player:submitAnswer', (payload, ack) => {
    const { error } = roomManager.submitAnswer(payload?.code, payload?.playerId, payload?.text);
    if (error) return ack?.({ ok: false, error });
    persist();
    ack?.({ ok: true });
  });

  socket.on('player:vote', (payload, ack) => {
    const { error } = roomManager.vote(payload?.code, payload?.playerId, payload?.entryId);
    if (error) return ack?.({ ok: false, error });
    persist();
    ack?.({ ok: true });
  });

  socket.on('player:endGame', (payload, ack) => {
    const { error } = roomManager.endGame(payload?.code, payload?.playerId);
    if (error) return ack?.({ ok: false, error });
    persist();
    ack?.({ ok: true });
  });

  socket.on('player:newGame', (payload, ack) => {
    const { error } = roomManager.newGameFromLobby(payload?.code, payload?.playerId);
    if (error) return ack?.({ ok: false, error });
    persist();
    ack?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const mapping = roomManager.disconnectSocket(socket.id);
    if (mapping) {
      const room = roomManager.getRoom(mapping.code);
      if (room) roomManager.broadcast(room);
      persist();
    }
  });
});

server.listen(config.port, () => {
  console.log(`Kokkelimonke running at http://localhost:${config.port}`);
  console.log(`  Open http://localhost:${config.port} on any phone`);
});
