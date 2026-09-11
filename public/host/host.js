(() => {
  const socket = io();
  const STORAGE_KEY = 'kokkelimonke_host_code';

  const screens = {
    create: document.getElementById('screen-create'),
    lobby: document.getElementById('screen-lobby'),
    round: document.getElementById('screen-round'),
    reveal: document.getElementById('screen-reveal'),
    scoreboard: document.getElementById('screen-scoreboard'),
    final: document.getElementById('screen-final'),
  };

  let currentCode = null;
  let timerHandle = null;
  let lastState = null;

  function showScreen(name) {
    for (const key of Object.keys(screens)) {
      screens[key].classList.toggle('hidden', key !== name);
    }
  }

  function ack(name, payload = {}) {
    return new Promise((resolve) => socket.emit(name, { code: currentCode, ...payload }, resolve));
  }

  document.getElementById('btn-create').addEventListener('click', async () => {
    const res = await new Promise((resolve) => socket.emit('host:createRoom', {}, resolve));
    if (!res.ok) {
      document.getElementById('create-error').textContent = res.error || 'Could not create room.';
      return;
    }
    currentCode = res.code;
    localStorage.setItem(STORAGE_KEY, currentCode);
    render(res.state);
  });

  document.getElementById('btn-start').addEventListener('click', async () => {
    const res = await ack('host:startGame');
    if (!res.ok) document.getElementById('lobby-error').textContent = res.error || 'Could not start.';
  });

  document.getElementById('btn-skip').addEventListener('click', () => ack('host:skipTimer'));
  document.getElementById('btn-extend').addEventListener('click', () => ack('host:extendTimer', { seconds: 15 }));
  const endGameBtn = document.getElementById('btn-end-from-round');
  let endGameArmed = false;
  let endGameResetHandle = null;
  endGameBtn.addEventListener('click', () => {
    if (!endGameArmed) {
      endGameArmed = true;
      endGameBtn.textContent = 'Click again to confirm';
      endGameResetHandle = setTimeout(() => {
        endGameArmed = false;
        endGameBtn.textContent = 'End Game';
      }, 3000);
      return;
    }
    clearTimeout(endGameResetHandle);
    endGameArmed = false;
    endGameBtn.textContent = 'End Game';
    ack('host:endGame');
  });
  document.getElementById('btn-reveal-next').addEventListener('click', () => ack('host:advanceReveal'));
  document.getElementById('btn-to-scoreboard').addEventListener('click', () => ack('host:goToScoreboard'));
  document.getElementById('btn-next-round').addEventListener('click', () => ack('host:nextRound'));
  document.getElementById('btn-new-game').addEventListener('click', () => ack('host:newGame'));

  socket.on('host:state', render);

  socket.on('connect', async () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const res = await new Promise((resolve) => socket.emit('host:attach', { code: stored }, resolve));
      if (res.ok) {
        currentCode = stored;
        render(res.state);
        return;
      }
      localStorage.removeItem(STORAGE_KEY);
    }
    showScreen('create');
  });

  function render(state) {
    lastState = state;
    if (state.phase === 'lobby') renderLobby(state);
    else if (state.phase === 'writing' || state.phase === 'voting') renderRound(state);
    else if (state.phase === 'reveal') renderReveal(state);
    else if (state.phase === 'scoreboard') renderScoreboard(state);
    else if (state.phase === 'final') renderFinal(state);
  }

  function renderLobby(state) {
    showScreen('lobby');
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

  function renderRound(state) {
    showScreen('round');
    document.getElementById('round-label').textContent = `Round ${state.round} / ${state.totalRounds}`;
    document.getElementById('phase-label').textContent = state.phase === 'writing' ? 'Writing' : 'Voting';
    document.getElementById('round-category').textContent = state.currentQuestion.category;
    document.getElementById('round-question').textContent = state.currentQuestion.question;
    const progress = document.getElementById('round-progress');
    if (state.phase === 'writing') {
      progress.textContent = `${state.answeredCount} of ${state.totalActive} answered`;
    } else {
      progress.textContent = `${state.votedCount} of ${state.totalActive} voted`;
    }
    startTimer(state.phaseEndsAt, state.phase === 'writing' ? 45 : 30);
  }

  function renderReveal(state) {
    showScreen('reveal');
    document.getElementById('reveal-round-label').textContent = `Round ${state.round} / ${state.totalRounds}`;
    document.getElementById('reveal-question').textContent = state.currentQuestion.question;
    const list = document.getElementById('reveal-list');
    list.innerHTML = '';
    state.answerList.forEach((entry) => {
      list.appendChild(buildRevealEntry(entry));
    });
    document.getElementById('btn-reveal-next').classList.toggle('hidden', state.done);
    document.getElementById('btn-to-scoreboard').classList.toggle('hidden', !state.done);
    stopTimer();
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
    document.getElementById('btn-next-round').textContent =
      state.round >= state.totalRounds ? 'See Final Results' : 'Next Round';
    stopTimer();
  }

  function renderFinal(state) {
    showScreen('final');
    const winner = state.players[0];
    document.getElementById('final-winner').textContent = winner ? `${winner.name} wins!` : 'Game Over';
    const list = document.getElementById('final-players');
    list.innerHTML = '';
    state.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span><span class="rank-num">#${i + 1}</span><span class="name">${escapeHtml(p.name)}</span></span><span class="score">${p.score}</span>`;
      list.appendChild(li);
    });
    stopTimer();
  }

  function startTimer(endsAt, totalSeconds) {
    stopTimer();
    const fill = document.getElementById('timer-fill');
    function tick() {
      const remainingMs = endsAt - Date.now();
      const ratio = Math.max(0, Math.min(1, remainingMs / (totalSeconds * 1000)));
      fill.style.width = `${ratio * 100}%`;
      fill.classList.toggle('low', ratio < 0.25);
    }
    tick();
    timerHandle = setInterval(tick, 250);
  }

  function stopTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }
})();
