const config = require('./config');
const questionBank = require('./questions.json');
const { generateRoomCode } = require('./roomCode');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    roundsCorrect: p.roundsCorrect,
    foolsTotal: p.foolsTotal,
    queued: p.queued,
  };
}

class RoomManager {
  constructor(io, persistedRooms) {
    this.io = io;
    this.rooms = {}; // code -> room state
    this.socketToPlayer = {}; // socketId -> { code, playerId }
    this.hostSockets = {}; // code -> socketId

    for (const [code, room] of Object.entries(persistedRooms || {})) {
      room.timer = null;
      for (const p of Object.values(room.players)) p.connected = false;
      this.rooms[code] = room;
    }
  }

  persist(store) {
    store.save(this.rooms);
  }

  // ---------- room lifecycle ----------

  createRoom() {
    const code = generateRoomCode((c) => !!this.rooms[c]);
    const room = {
      code,
      createdAt: Date.now(),
      phase: 'lobby',
      round: 0,
      totalRounds: config.rounds,
      usedQuestions: [],
      currentQuestion: null,
      players: {},
      queue: [],
      submissions: {},
      missed: {},
      answerList: [],
      votes: {},
      phaseEndsAt: null,
      revealStep: 0,
      lastRoundResults: null,
      gameStarted: false,
      timer: null,
    };
    this.rooms[code] = room;
    return room;
  }

  getRoom(code) {
    return this.rooms[(code || '').toUpperCase()];
  }

  attachHost(code, socketId) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    this.hostSockets[code] = socketId;
    return { room };
  }

  // ---------- players ----------

  joinPlayer(code, { name, playerId }, socketId) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found. Check the code.' };
    const cleanName = (name || '').trim().slice(0, 24);
    if (!cleanName) return { error: 'Enter a name.' };

    // Reconnect only when the stored id still belongs to that same name — a stale
    // or reused id whose name doesn't match must never hijack someone else's record
    // (e.g. a shared device, or a different person picking up an old session).
    let player = null;
    if (playerId && room.players[playerId] && room.players[playerId].name.toLowerCase() === cleanName.toLowerCase()) {
      player = room.players[playerId];
    }
    if (!player) {
      player = Object.values(room.players).find(
        (p) => p.name.toLowerCase() === cleanName.toLowerCase()
      );
    }

    if (player) {
      player.connected = true;
      this.socketToPlayer[socketId] = { code, playerId: player.id };
      return { room, player, resumed: true };
    }

    const inLobby = room.phase === 'lobby' && !room.gameStarted;
    const newPlayer = {
      id: makeId(),
      name: cleanName,
      score: 0,
      connected: true,
      roundsCorrect: 0,
      foolsTotal: 0,
      queued: !inLobby,
      joinedAt: Date.now(),
    };

    if (inLobby) {
      room.players[newPlayer.id] = newPlayer;
    } else {
      room.players[newPlayer.id] = newPlayer; // stored, but flagged queued so it's excluded from active-round logic
    }

    this.socketToPlayer[socketId] = { code, playerId: newPlayer.id };
    return { room, player: newPlayer, resumed: false };
  }

  disconnectSocket(socketId) {
    for (const [code, hostSocketId] of Object.entries(this.hostSockets)) {
      if (hostSocketId === socketId) delete this.hostSockets[code];
    }
    const mapping = this.socketToPlayer[socketId];
    if (!mapping) return null;
    delete this.socketToPlayer[socketId];
    const room = this.getRoom(mapping.code);
    if (room && room.players[mapping.playerId]) {
      room.players[mapping.playerId].connected = false;
    }
    return mapping;
  }

  activePlayers(room) {
    return Object.values(room.players).filter((p) => !p.queued);
  }

  // ---------- game flow ----------

  startGame(code) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    const active = this.activePlayers(room);
    if (active.length < config.minPlayers) {
      return { error: `Need at least ${config.minPlayers} players to start.` };
    }
    room.gameStarted = true;
    room.round = 0;
    this.advanceToNextRound(room);
    return { room };
  }

  pickQuestion(room) {
    const available = questionBank
      .map((q, i) => i)
      .filter((i) => !room.usedQuestions.includes(i));
    const pool = available.length > 0 ? available : questionBank.map((_, i) => i);
    if (available.length === 0) room.usedQuestions = [];
    const idx = pool[Math.floor(Math.random() * pool.length)];
    room.usedQuestions.push(idx);
    return questionBank[idx];
  }

  advanceToNextRound(room) {
    this.clearTimer(room);

    // Promote queued players waiting in the lobby into the active pool.
    for (const p of Object.values(room.players)) {
      if (p.queued) p.queued = false;
    }

    room.round += 1;
    if (room.round > room.totalRounds) {
      room.phase = 'final';
      room.phaseEndsAt = null;
      this.broadcast(room);
      return;
    }

    room.currentQuestion = this.pickQuestion(room);
    room.submissions = {};
    room.missed = {};
    room.answerList = [];
    room.votes = {};
    room.revealStep = 0;
    room.lastRoundResults = null;
    room.phase = 'writing';
    room.phaseEndsAt = Date.now() + config.writingSeconds * 1000;

    this.setTimer(room, config.writingSeconds * 1000, () => this.lockAnswers(room.code));
    this.broadcast(room);
  }

  submitAnswer(code, playerId, text) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.phase !== 'writing') return { error: 'Writing phase is over.' };
    const player = room.players[playerId];
    if (!player || player.queued) return { error: 'You are not in this round.' };
    const clean = (text || '').trim().slice(0, 140);
    if (!clean) return { error: 'Answer cannot be empty.' };
    room.submissions[playerId] = clean;

    if (this.allActiveDone(room, room.submissions)) {
      this.lockAnswers(code);
    } else {
      this.broadcast(room);
    }
    return { room };
  }

  allActiveDone(room, map) {
    const active = this.activePlayers(room).filter((p) => p.connected || map[p.id]);
    if (active.length === 0) return false;
    return active.every((p) => map[p.id] !== undefined);
  }

  lockAnswers(code) {
    const room = this.getRoom(code);
    if (!room || room.phase !== 'writing') return;
    this.clearTimer(room);

    const entries = [];
    for (const player of this.activePlayers(room)) {
      const text = room.submissions[player.id];
      if (text === undefined) {
        room.missed[player.id] = true;
        continue; // filler answers are excluded as bluff options entirely
      }
      entries.push({ entryId: makeId(), ownerId: player.id, text, isReal: false });
    }
    entries.push({
      entryId: makeId(),
      ownerId: null,
      text: room.currentQuestion.answer,
      isReal: true,
    });

    room.answerList = shuffle(entries);
    room.phase = 'voting';
    room.phaseEndsAt = Date.now() + config.votingSeconds * 1000;
    this.setTimer(room, config.votingSeconds * 1000, () => this.lockVotes(code));
    this.broadcast(room);
  }

  vote(code, playerId, entryId) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.phase !== 'voting') return { error: 'Voting phase is over.' };
    const player = room.players[playerId];
    if (!player || player.queued) return { error: 'You are not in this round.' };
    const entry = room.answerList.find((e) => e.entryId === entryId);
    if (!entry) return { error: 'Invalid option.' };
    if (entry.ownerId === playerId) return { error: 'You cannot vote for your own answer.' };

    room.votes[playerId] = entryId;

    if (this.allActiveDone(room, room.votes)) {
      this.lockVotes(code);
    } else {
      this.broadcast(room);
    }
    return { room };
  }

  lockVotes(code) {
    const room = this.getRoom(code);
    if (!room || room.phase !== 'voting') return;
    this.clearTimer(room);
    room.lastRoundResults = this.computeRoundResults(room);
    room.phase = 'reveal';
    room.revealStep = 0;
    room.phaseEndsAt = null;
    this.broadcast(room);
  }

  computeRoundResults(room) {
    const votesFor = {};
    for (const entry of room.answerList) votesFor[entry.entryId] = 0;
    for (const entryId of Object.values(room.votes)) {
      if (votesFor[entryId] !== undefined) votesFor[entryId] += 1;
    }
    const totalVotesCast = Object.keys(room.votes).length;
    const realEntry = room.answerList.find((e) => e.isReal);
    const perPlayerRoundPoints = {};
    const entriesResult = [];

    for (const entry of room.answerList) {
      const votes = votesFor[entry.entryId] || 0;
      const voterNames = Object.entries(room.votes)
        .filter(([, chosen]) => chosen === entry.entryId)
        .map(([voterId]) => room.players[voterId]?.name)
        .filter(Boolean);

      let pointsAwarded = 0;
      if (!entry.isReal && entry.ownerId) {
        const ownerVoted = room.votes[entry.ownerId] !== undefined;
        const othersWhoVoted = totalVotesCast - (ownerVoted ? 1 : 0);
        pointsAwarded += votes * config.points.perFool;
        if (othersWhoVoted > 0 && votes === othersWhoVoted) {
          pointsAwarded += config.points.unanimousFoolBonus;
        }
        perPlayerRoundPoints[entry.ownerId] = (perPlayerRoundPoints[entry.ownerId] || 0) + pointsAwarded;
        const owner = room.players[entry.ownerId];
        if (owner) owner.foolsTotal += votes;
      }

      entriesResult.push({
        entryId: entry.entryId,
        ownerId: entry.ownerId,
        ownerName: entry.ownerId ? room.players[entry.ownerId]?.name || '???' : null,
        text: entry.text,
        isReal: entry.isReal,
        votes,
        voterNames,
        pointsAwarded,
      });
    }

    // Correct guesses: only players who actually submitted an answer this round.
    for (const [voterId, chosenEntryId] of Object.entries(room.votes)) {
      if (room.missed[voterId]) continue;
      if (realEntry && chosenEntryId === realEntry.entryId) {
        perPlayerRoundPoints[voterId] = (perPlayerRoundPoints[voterId] || 0) + config.points.correctGuess;
        const player = room.players[voterId];
        if (player) player.roundsCorrect += 1;
      }
    }

    for (const [playerId, pts] of Object.entries(perPlayerRoundPoints)) {
      const player = room.players[playerId];
      if (player) player.score += pts;
    }

    return { entries: entriesResult, perPlayerRoundPoints, realEntryId: realEntry?.entryId };
  }

  advanceReveal(code) {
    const room = this.getRoom(code);
    if (!room || room.phase !== 'reveal') return { error: 'Not in reveal phase.' };
    if (room.revealStep < room.lastRoundResults.entries.length) {
      room.revealStep += 1;
      this.broadcast(room);
    }
    return { room };
  }

  goToScoreboard(code) {
    const room = this.getRoom(code);
    if (!room || room.phase !== 'reveal') return { error: 'Not in reveal phase.' };
    room.phase = 'scoreboard';
    this.broadcast(room);
    return { room };
  }

  nextRound(code) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.phase !== 'scoreboard') return { error: 'Finish this round first.' };
    this.advanceToNextRound(room);
    return { room };
  }

  skipTimer(code) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.phase === 'writing') this.lockAnswers(code);
    else if (room.phase === 'voting') this.lockVotes(code);
    return { room };
  }

  skipQuestion(code) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.phase !== 'writing' && room.phase !== 'voting') {
      return { error: 'Can only skip during writing or voting.' };
    }
    this.clearTimer(room);
    room.currentQuestion = this.pickQuestion(room);
    room.submissions = {};
    room.missed = {};
    room.answerList = [];
    room.votes = {};
    room.revealStep = 0;
    room.lastRoundResults = null;
    room.phase = 'writing';
    room.phaseEndsAt = Date.now() + config.writingSeconds * 1000;
    this.setTimer(room, config.writingSeconds * 1000, () => this.lockAnswers(room.code));
    this.broadcast(room);
    return { room };
  }

  extendTimer(code, seconds) {
    const room = this.getRoom(code);
    if (!room || !room.phaseEndsAt) return { error: 'No active timer.' };
    const extra = Math.max(0, Math.min(120, Number(seconds) || 0));
    room.phaseEndsAt += extra * 1000;
    this.clearTimer(room);
    const remaining = room.phaseEndsAt - Date.now();
    const cb = room.phase === 'writing'
      ? () => this.lockAnswers(code)
      : () => this.lockVotes(code);
    this.setTimer(room, Math.max(0, remaining), cb);
    this.broadcast(room);
    return { room };
  }

  endGame(code) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    this.clearTimer(room);
    room.phase = 'final';
    room.phaseEndsAt = null;
    this.broadcast(room);
    return { room };
  }

  newGameFromLobby(code) {
    // Reset scores/rounds but keep the room + players so the same TV/group can play again.
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    this.clearTimer(room);
    room.phase = 'lobby';
    room.round = 0;
    room.gameStarted = false;
    room.usedQuestions = [];
    room.currentQuestion = null;
    room.submissions = {};
    room.missed = {};
    room.answerList = [];
    room.votes = {};
    room.phaseEndsAt = null;
    room.revealStep = 0;
    room.lastRoundResults = null;
    for (const p of Object.values(room.players)) {
      p.score = 0;
      p.roundsCorrect = 0;
      p.foolsTotal = 0;
      p.queued = false;
    }
    this.broadcast(room);
    return { room };
  }

  // ---------- timers ----------

  setTimer(room, ms, cb) {
    room.timer = setTimeout(() => {
      room.timer = null;
      cb();
    }, ms);
  }

  clearTimer(room) {
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
  }

  // ---------- broadcasting ----------

  rankedPlayers(room) {
    return Object.values(room.players)
      .filter((p) => !p.queued)
      .sort((a, b) => b.score - a.score || b.roundsCorrect - a.roundsCorrect || b.foolsTotal - a.foolsTotal)
      .map(publicPlayer);
  }

  hostView(room) {
    const activeCount = this.activePlayers(room).length;
    const view = {
      code: room.code,
      phase: room.phase,
      round: room.round,
      totalRounds: room.totalRounds,
      players: this.rankedPlayers(room),
      queuedCount: Object.values(room.players).filter((p) => p.queued).length,
      minPlayers: config.minPlayers,
      recommendedPlayers: config.recommendedPlayers,
      phaseEndsAt: room.phaseEndsAt,
      currentQuestion: room.currentQuestion,
    };
    if (room.phase === 'writing') {
      view.answeredCount = Object.keys(room.submissions).length;
      view.totalActive = activeCount;
    }
    if (room.phase === 'voting') {
      view.votedCount = Object.keys(room.votes).length;
      view.totalActive = activeCount;
    }
    if (room.phase === 'reveal') {
      view.answerList = room.lastRoundResults.entries.slice(0, room.revealStep);
      view.revealStep = room.revealStep;
      view.revealTotal = room.lastRoundResults.entries.length;
      view.done = room.revealStep >= room.lastRoundResults.entries.length;
    }
    return view;
  }

  playerView(room, playerId) {
    const player = room.players[playerId];
    if (!player) return null;
    const view = {
      code: room.code,
      phase: room.phase,
      round: room.round,
      totalRounds: room.totalRounds,
      you: publicPlayer(player),
      queued: player.queued,
      currentQuestion: room.currentQuestion,
      phaseEndsAt: room.phaseEndsAt,
      minPlayers: config.minPlayers,
      players: this.rankedPlayers(room),
    };
    if (player.queued) return view;

    if (room.phase === 'writing') {
      view.yourAnswer = room.submissions[playerId] || null;
    }
    if (room.phase === 'voting') {
      view.options = room.answerList.map((e) => ({
        entryId: e.entryId,
        text: e.text,
        isYours: e.ownerId === playerId,
      }));
      view.yourVote = room.votes[playerId] || null;
    }
    if (room.phase === 'reveal') {
      const results = room.lastRoundResults;
      view.answerList = results.entries.slice(0, room.revealStep);
      view.revealTotal = results.entries.length;
      view.pointsThisRound = results.perPlayerRoundPoints[playerId] || 0;
      view.missed = !!room.missed[playerId];
    }
    if (room.phase === 'scoreboard') {
      const results = room.lastRoundResults;
      view.pointsThisRound = results ? (results.perPlayerRoundPoints[playerId] || 0) : 0;
      view.rank = this.rankedPlayers(room).findIndex((p) => p.id === playerId) + 1;
    }
    if (room.phase === 'final') {
      view.rank = this.rankedPlayers(room).findIndex((p) => p.id === playerId) + 1;
    }
    return view;
  }

  broadcast(room) {
    const hostSocketId = this.hostSockets[room.code];
    if (hostSocketId) {
      this.io.to(hostSocketId).emit('host:state', this.hostView(room));
    }
    for (const [socketId, mapping] of Object.entries(this.socketToPlayer)) {
      if (mapping.code !== room.code) continue;
      const view = this.playerView(room, mapping.playerId);
      if (view) this.io.to(socketId).emit('player:state', view);
    }
  }
}

module.exports = { RoomManager };
