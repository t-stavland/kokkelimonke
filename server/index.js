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
  const joinUrl = `${req.protocol}://${host}/play?code=${encodeURIComponent(room.code)}`;
  res.type('png');
  QRCode.toFileStream(res, joinUrl, { width: 320, margin: 1 });
});

function persist() {
  roomManager.persist(store);
}

io.on('connection', (socket) => {
  socket.on('host:createRoom', (payload, ack) => {
    const room = roomManager.createRoom();
    roomManager.attachHost(room.code, socket.id);
    persist();
    ack?.({ ok: true, code: room.code, state: roomManager.hostView(room) });
  });

  socket.on('host:attach', (payload, ack) => {
    const { room, error } = roomManager.attachHost(payload?.code, socket.id);
    if (error) return ack?.({ ok: false, error });
    ack?.({ ok: true, code: room.code, state: roomManager.hostView(room) });
  });

  socket.on('host:startGame', (payload, ack) => {
    const { room, error } = roomManager.startGame(payload?.code);
    if (error) return ack?.({ ok: false, error });
    persist();
    ack?.({ ok: true });
  });

  socket.on('host:skipTimer', (payload, ack) => {
    roomManager.skipTimer(payload?.code);
    persist();
    ack?.({ ok: true });
  });

  socket.on('host:skipQuestion', (payload, ack) => {
    const { error } = roomManager.skipQuestion(payload?.code);
    if (error) return ack?.({ ok: false, error });
    persist();
    ack?.({ ok: true });
  });

  socket.on('host:extendTimer', (payload, ack) => {
    roomManager.extendTimer(payload?.code, payload?.seconds);
    persist();
    ack?.({ ok: true });
  });

  socket.on('host:advanceReveal', (payload, ack) => {
    roomManager.advanceReveal(payload?.code);
    persist();
    ack?.({ ok: true });
  });

  socket.on('host:goToScoreboard', (payload, ack) => {
    roomManager.goToScoreboard(payload?.code);
    persist();
    ack?.({ ok: true });
  });

  socket.on('host:nextRound', (payload, ack) => {
    const { error } = roomManager.nextRound(payload?.code);
    if (error) return ack?.({ ok: false, error });
    persist();
    ack?.({ ok: true });
  });

  socket.on('host:endGame', (payload, ack) => {
    roomManager.endGame(payload?.code);
    persist();
    ack?.({ ok: true });
  });

  socket.on('host:newGame', (payload, ack) => {
    roomManager.newGameFromLobby(payload?.code);
    persist();
    ack?.({ ok: true });
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
  console.log(`  Host screen: http://localhost:${config.port}/host`);
  console.log(`  Player join: http://localhost:${config.port}/play`);
});
