(() => {
  const socket = io();

  const screens = {
    join: document.getElementById('screen-join'),
    queued: document.getElementById('screen-queued'),
    writing: document.getElementById('screen-writing'),
    voting: document.getElementById('screen-voting'),
    reveal: document.getElementById('screen-reveal'),
    scoreboard: document.getElementById('screen-scoreboard'),
    final: document.getElementById('screen-final'),
  };

  let code = null;
  let playerId = null;
  let timerHandle = null;
  let submittedThisRound = false;
  let votedThisRound = false;
  let lastPhase = null;

  function showScreen(name) {
    for (const key of Object.keys(screens)) {
      screens[key].classList.toggle('hidden', key !== name);
    }
  }

  function storageKey(c) {
    return `kokkelimonke_player_${c.toUpperCase()}`;
  }

  function loadSaved(c) {
    try {
      return JSON.parse(localStorage.getItem(storageKey(c)) || 'null');
    } catch {
      return null;
    }
  }

  function saveSelf(c, name, id) {
    localStorage.setItem(storageKey(c), JSON.stringify({ name, playerId: id }));
  }

  // Prefill from ?code= (QR scan) and any saved session for that code.
  const params = new URLSearchParams(location.search);
  const prefillCode = (params.get('code') || '').toUpperCase();
  if (prefillCode) document.getElementById('input-code').value = prefillCode;
  const saved = prefillCode ? loadSaved(prefillCode) : null;
  if (saved) {
    document.getElementById('input-name').value = saved.name || '';
  }

  document.getElementById('input-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  document.getElementById('btn-join').addEventListener('click', doJoin);
  document.getElementById('input-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  function doJoin() {
    const codeInput = document.getElementById('input-code').value.trim().toUpperCase();
    const nameInput = document.getElementById('input-name').value.trim();
    const errEl = document.getElementById('join-error');
    errEl.textContent = '';
    if (!codeInput || !nameInput) {
      errEl.textContent = 'Enter both a room code and your name.';
      return;
    }
    const savedForCode = loadSaved(codeInput);
    socket.emit(
      'player:join',
      { code: codeInput, name: nameInput, playerId: savedForCode?.playerId },
      (res) => {
        if (!res.ok) {
          errEl.textContent = res.error || 'Could not join.';
          return;
        }
        code = codeInput;
        playerId = res.playerId;
        saveSelf(code, nameInput, playerId);
        render(res.state);
      }
    );
  }

  socket.on('player:state', (state) => {
    if (!code) return; // ignore stray events before we've joined
    render(state);
  });

  function render(state) {
    if (state.phase !== lastPhase) {
      submittedThisRound = false;
      votedThisRound = false;
      lastPhase = state.phase;
    }

    if (state.queued) {
      showScreen('queued');
      return;
    }
    if (state.phase === 'lobby') {
      showScreen('queued');
      document.querySelector('#screen-queued p').textContent = "You're in! Waiting for the host to start the game...";
      return;
    }
    if (state.phase === 'writing') renderWriting(state);
    else if (state.phase === 'voting') renderVoting(state);
    else if (state.phase === 'reveal') renderReveal(state);
    else if (state.phase === 'scoreboard') renderScoreboard(state);
    else if (state.phase === 'final') renderFinal(state);
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

  function renderWriting(state) {
    showScreen('writing');
    document.getElementById('write-category').textContent = state.currentQuestion.category;
    document.getElementById('write-question').textContent = state.currentQuestion.question;
    startTimer('write-timer-fill', state.phaseEndsAt, 45);

    const alreadyIn = !!state.yourAnswer || submittedThisRound;
    document.getElementById('write-form').classList.toggle('hidden', alreadyIn);
    document.getElementById('write-waiting').classList.toggle('hidden', !alreadyIn);
    if (!alreadyIn) document.getElementById('write-answer').value = '';
  }

  function renderVoting(state) {
    showScreen('voting');
    document.getElementById('vote-question').textContent = state.currentQuestion.question;
    startTimer('vote-timer-fill', state.phaseEndsAt, 30);

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
    document.getElementById('scoreboard-round-points').textContent = `+${state.pointsThisRound}`;
    document.getElementById('scoreboard-rank').textContent = `#${state.rank}`;
    document.getElementById('scoreboard-total').textContent = state.you.score;
    stopTimer();
  }

  function renderFinal(state) {
    showScreen('final');
    const won = state.rank === 1;
    document.getElementById('final-trophy').textContent = won ? '🏆' : '🎉';
    document.getElementById('final-headline').textContent = won ? 'You won!' : 'Game Over';
    document.getElementById('final-rank').textContent = `#${state.rank}`;
    document.getElementById('final-score').textContent = state.you.score;
    stopTimer();
  }

  function startTimer(elId, endsAt, totalSeconds) {
    stopTimer();
    const fill = document.getElementById(elId);
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
