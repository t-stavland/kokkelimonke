(() => {
  const socket = io();
  const LAST_SESSION_KEY = 'kokkelimonke_last_session';

  const screens = {
    entry: document.getElementById('screen-entry'),
    lobbyHost: document.getElementById('screen-lobby-host'),
    lobbyWait: document.getElementById('screen-lobby-wait'),
    writing: document.getElementById('screen-writing'),
    voting: document.getElementById('screen-voting'),
    reveal: document.getElementById('screen-reveal'),
    scoreboard: document.getElementById('screen-scoreboard'),
    final: document.getElementById('screen-final'),
  };

  let code = null;
  let playerId = null;
  let submittedThisRound = false;
  let votedThisRound = false;
  let lastPhase = null;

  function showScreen(name) {
    for (const key of Object.keys(screens)) {
      screens[key].classList.toggle('hidden', key !== name);
    }
  }

  function saveSession(c, name, id) {
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ code: c, name, playerId: id }));
  }

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(LAST_SESSION_KEY) || 'null');
    } catch {
      return null;
    }
  }

  // ---------- entry screen ----------

  const params = new URLSearchParams(location.search);
  const prefillCode = (params.get('code') || '').toUpperCase();

  document.getElementById('btn-show-host').addEventListener('click', () => {
    document.getElementById('host-form').classList.remove('hidden');
    document.getElementById('join-form').classList.add('hidden');
  });

  document.getElementById('btn-show-join').addEventListener('click', () => {
    document.getElementById('join-form').classList.remove('hidden');
    document.getElementById('host-form').classList.add('hidden');
  });

  document.getElementById('input-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  document.getElementById('btn-host-create').addEventListener('click', () => {
    const name = document.getElementById('host-name').value.trim();
    const errEl = document.getElementById('entry-error');
    if (!name) {
      errEl.textContent = 'Enter your name.';
      return;
    }
    socket.emit('player:hostNewGame', { name }, (res) => {
      if (!res.ok) {
        errEl.textContent = res.error || 'Could not create room.';
        return;
      }
      errEl.textContent = '';
      code = res.code;
      playerId = res.playerId;
      saveSession(code, name, playerId);
      render(res.state);
    });
  });

  document.getElementById('btn-join').addEventListener('click', doJoin);
  document.getElementById('input-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  function doJoin() {
    const codeInput = document.getElementById('input-code').value.trim().toUpperCase();
    const nameInput = document.getElementById('input-name').value.trim();
    const errEl = document.getElementById('entry-error');
    errEl.textContent = '';
    if (!codeInput || !nameInput) {
      errEl.textContent = 'Enter both a room code and your name.';
      return;
    }
    socket.emit('player:join', { code: codeInput, name: nameInput }, (res) => {
      if (!res.ok) {
        errEl.textContent = res.error || 'Could not join.';
        return;
      }
      code = codeInput;
      playerId = res.playerId;
      saveSession(code, nameInput, playerId);
      render(res.state);
    });
  }

  // ---------- auto-reconnect on load ----------

  function tryAutoRejoin() {
    const saved = loadSession();
    if (!saved) {
      if (prefillCode) {
        document.getElementById('input-code').value = prefillCode;
        document.getElementById('btn-show-join').click();
      }
      showScreen('entry');
      return;
    }
    socket.emit('player:join', { code: saved.code, name: saved.name, playerId: saved.playerId }, (res) => {
      if (!res.ok) {
        localStorage.removeItem(LAST_SESSION_KEY);
        if (prefillCode) {
          document.getElementById('input-code').value = prefillCode;
          document.getElementById('btn-show-join').click();
        }
        showScreen('entry');
        return;
      }
      code = saved.code;
      playerId = res.playerId;
      render(res.state);
    });
  }

  socket.on('connect', tryAutoRejoin);

  function leaveSession() {
    localStorage.removeItem(LAST_SESSION_KEY);
    location.reload();
  }
  document.getElementById('link-leave-lobby-host').addEventListener('click', (e) => {
    e.preventDefault();
    leaveSession();
  });
  document.getElementById('link-leave-lobby-wait').addEventListener('click', (e) => {
    e.preventDefault();
    leaveSession();
  });

  socket.on('player:state', (state) => {
    if (!code) return; // ignore stray events before we've joined
    render(state);
  });

  // ---------- rendering ----------

  document.getElementById('btn-start').addEventListener('click', () => {
    const errEl = document.getElementById('lobby-error');
    socket.emit('player:startGame', { code, playerId }, (res) => {
      if (!res.ok) errEl.textContent = res.error || 'Could not start.';
    });
  });

  document.getElementById('btn-play-again').addEventListener('click', () => {
    socket.emit('player:newGame', { code, playerId }, () => {});
  });

  function render(state) {
    if (state.phase !== lastPhase) {
      submittedThisRound = false;
      votedThisRound = false;
      lastPhase = state.phase;
    }

    if (state.queued) {
      showScreen('lobbyWait');
      document.getElementById('lobby-wait-text').textContent =
        "You're in! A game is already in progress — you'll join at the next round.";
      return;
    }
    if (state.phase === 'lobby') {
      if (state.isHost) renderLobbyHost(state);
      else {
        showScreen('lobbyWait');
        document.getElementById('lobby-wait-text').textContent = "You're in! Waiting for the host to start the game...";
      }
      return;
    }
    if (state.phase === 'writing') renderWriting(state);
    else if (state.phase === 'voting') renderVoting(state);
    else if (state.phase === 'reveal') renderReveal(state);
    else if (state.phase === 'scoreboard') renderScoreboard(state);
    else if (state.phase === 'final') renderFinal(state);
  }

  function renderLobbyHost(state) {
    showScreen('lobbyHost');
    document.getElementById('lobby-code').textContent = state.code;
    document.getElementById('lobby-qr').src = `/qr/${state.code}`;
    document.getElementById('lobby-count').textContent = state.players.length;
    const list = document.getElementById('lobby-players');
    list.innerHTML = '';
    state.players.forEach((p) => {
      const li = document.createElement('li');
      if (!p.connected) li.classList.add('disconnected');
      li.innerHTML = `<span class="name">${escapeHtml(p.name)}</span>`;
      list.appendChild(li);
    });
    const hint = document.getElementById('lobby-hint');
    if (state.players.length < state.minPlayers) {
      hint.textContent = `Need at least ${state.minPlayers} players to start.`;
    } else if (state.players.length < state.recommendedPlayers) {
      hint.textContent = `You can start now — ${state.recommendedPlayers}+ players makes it even better.`;
    } else {
      hint.textContent = 'Ready to go!';
    }
    document.getElementById('btn-start').disabled = state.players.length < state.minPlayers;
  }

  function renderWriting(state) {
    showScreen('writing');
    document.getElementById('write-category').textContent = state.currentQuestion.category;
    document.getElementById('write-question').textContent = state.currentQuestion.question;
    document.getElementById('write-progress').textContent = `${state.answeredCount} of ${state.totalActive} answered`;

    const alreadyIn = !!state.yourAnswer || submittedThisRound;
    document.getElementById('write-form').classList.toggle('hidden', alreadyIn);
    document.getElementById('write-waiting').classList.toggle('hidden', !alreadyIn);
    if (!alreadyIn) document.getElementById('write-answer').value = '';
  }

  document.getElementById('btn-submit-answer').addEventListener('click', () => {
    const text = document.getElementById('write-answer').value.trim();
    const errEl = document.getElementById('write-error');
    if (!text) {
      errEl.textContent = 'Type an answer first.';
      return;
    }
    socket.emit('player:submitAnswer', { code, playerId, text }, (res) => {
      if (!res.ok) {
        errEl.textContent = res.error || 'Could not submit.';
        return;
      }
      errEl.textContent = '';
      submittedThisRound = true;
      document.getElementById('write-form').classList.add('hidden');
      document.getElementById('write-waiting').classList.remove('hidden');
    });
  });

  function renderVoting(state) {
    showScreen('voting');
    document.getElementById('vote-question').textContent = state.currentQuestion.question;
    document.getElementById('vote-progress').textContent = `${state.votedCount} of ${state.totalActive} voted`;

    const votedAlready = !!state.yourVote || votedThisRound;
    const container = document.getElementById('vote-options');
    container.innerHTML = '';
    state.options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      if (opt.isYours) btn.classList.add('mine');
      if (state.yourVote === opt.entryId) btn.classList.add('selected');
      btn.textContent = opt.isYours ? `${opt.text}  (yours)` : opt.text;
      btn.disabled = opt.isYours || votedAlready;
      btn.addEventListener('click', () => castVote(opt.entryId));
      container.appendChild(btn);
    });
    document.getElementById('vote-waiting').classList.toggle('hidden', !votedAlready);
  }

  function castVote(entryId) {
    const errEl = document.getElementById('vote-error');
    socket.emit('player:vote', { code, playerId, entryId }, (res) => {
      if (!res.ok) {
        errEl.textContent = res.error || 'Could not vote.';
        return;
      }
      errEl.textContent = '';
      votedThisRound = true;
    });
  }

  function renderReveal(state) {
    showScreen('reveal');
    document.getElementById('reveal-round-label').textContent = `Round ${state.round} / ${state.totalRounds}`;
    document.getElementById('reveal-question').textContent = state.currentQuestion.question;
    const list = document.getElementById('reveal-list');
    list.innerHTML = '';
    state.answerList.forEach((entry) => list.appendChild(buildRevealEntry(entry)));
    const pointsEl = document.getElementById('reveal-points');
    if (state.missed) {
      pointsEl.textContent = "You didn't answer in time — no points this round.";
    } else {
      pointsEl.textContent = `+${state.pointsThisRound} points this round`;
    }
  }

  function buildRevealEntry(entry) {
    const div = document.createElement('div');
    div.className = 'reveal-entry' + (entry.isReal ? ' real' : '');
    const who = entry.isReal ? '<strong>The real answer</strong>' : escapeHtml(entry.ownerName || 'Unknown');
    const pts = entry.pointsAwarded ? `<span class="points">+${entry.pointsAwarded}</span>` : '';
    div.innerHTML = `
      <div class="entry-text">${escapeHtml(entry.text)}</div>
      <div class="entry-meta"><span>${who}</span><span>${entry.votes} vote${entry.votes === 1 ? '' : 's'} ${pts}</span></div>
    `;
    return div;
  }

  function renderScoreboard(state) {
    showScreen('scoreboard');
    const list = document.getElementById('scoreboard-players');
    list.innerHTML = '';
    state.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span><span class="rank-num">#${i + 1}</span><span class="name">${escapeHtml(p.name)}</span></span><span class="score">${p.score}</span>`;
      list.appendChild(li);
    });
  }

  function renderFinal(state) {
    showScreen('final');
    const won = state.rank === 1;
    document.getElementById('final-trophy').textContent = won ? '🏆' : '🎉';
    document.getElementById('final-headline').textContent = won ? 'You won!' : 'Game Over';
    const list = document.getElementById('final-players');
    list.innerHTML = '';
    state.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span><span class="rank-num">#${i + 1}</span><span class="name">${escapeHtml(p.name)}</span></span><span class="score">${p.score}</span>`;
      list.appendChild(li);
    });
    document.getElementById('btn-play-again').classList.toggle('hidden', !state.isHost);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }
})();
