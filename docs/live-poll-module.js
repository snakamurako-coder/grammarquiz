/**
 * 授業ライブ — リアルタイム投票（即興 v1）
 * ホスト操作は管理者のみ。生徒は PIN 参加後に投票画面へ。
 */
const LivePollModule = (function () {
  const CHOICE_SETS = {
    ABC: { label: 'A B C', choices: ['A', 'B', 'C'] },
    AIUE: { label: 'あ い う え', choices: ['あ', 'い', 'う', 'え'] },
    CIRCLED10: { label: '①〜⑩', choices: ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] },
    TF: { label: 'True False', choices: ['True', 'False'] },
    KATAKANA5: { label: 'ア イ ウ エ オ', choices: ['ア', 'イ', 'ウ', 'エ', 'オ'] },
    WRITTEN: { label: '記述', choices: [] }
  };
  const PIE_COLORS = ['#1976d2', '#fb8c00', '#43a047', '#e53935', '#8e24aa', '#00838f', '#f9a825', '#5d4037', '#546e7a', '#c2185b'];

  let hostOpen_ = false;
  let studentOpen_ = false;
  let lastHostSnap_ = null;
  let localAnswers_ = {};
  let localRound_ = 0;
  let collectTimerId_ = null;
  let hostEndedForRound_ = 0;
  let studentSig_ = '';

  function el_(id) {
    return document.getElementById(id);
  }

  function escapeHtml_(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isPollRoom_(room) {
    if (!room) return false;
    return room.mode === 'poll' || room.activity === 'poll';
  }

  function pub_(snap) {
    return (snap && snap.pollPublic) || {};
  }

  function normalizeText_(s) {
    s = String(s == null ? '' : s);
    s = s.replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    s = s.replace(/\u3000/g, ' ');
    s = s.replace(/[ \t\r\n]+/g, ' ').trim();
    return s;
  }

  function phaseLabel_(phase) {
    const map = {
      idle: '待機（設問なし）',
      prompt: '出題中・集約前',
      collecting: '集約中',
      waiting: '打ち切り（回答ロック）',
      results: '集計表示',
      reveal: '正答提示'
    };
    return map[phase] || phase || '—';
  }

  function currentQuestion_(pub) {
    const qs = pub.questions || [];
    const id = pub.reviewQuestionId || (pub.visibleQuestionIds && pub.visibleQuestionIds[0]);
    if (id) {
      for (let i = 0; i < qs.length; i++) {
        if (qs[i].id === id) return qs[i];
      }
    }
    return qs[0] || null;
  }

  function visibleQuestions_(pub) {
    const ids = pub.visibleQuestionIds || [];
    const qs = pub.questions || [];
    if (!ids.length) return qs.slice();
    return qs.filter(function (q) { return ids.indexOf(q.id) >= 0; });
  }

  function formatLimit_(sec) {
    const s = Math.max(0, parseInt(sec, 10) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m > 0) return m + ':' + String(r).padStart(2, '0');
    return String(r) + '秒';
  }

  function collectDurationFromUi_() {
    const minEl = el_('live-poll-timer-min');
    const secEl = el_('live-poll-timer-sec');
    const mins = Math.max(0, parseInt(minEl && minEl.value, 10) || 0);
    const secs = Math.max(0, parseInt(secEl && secEl.value, 10) || 0);
    return mins * 60 + secs;
  }

  function selectedChoiceSet_() {
    const checked = document.querySelector('input[name="live-poll-choice-set"]:checked');
    return (checked && checked.value) || 'ABC';
  }

  function pieHtml_(choiceCounts, choices, ownAnswer, totalOverride) {
    choices = choices || [];
    choiceCounts = choiceCounts || {};
    let total = 0;
    choices.forEach(function (c) {
      total += parseInt(choiceCounts[c], 10) || 0;
    });
    if (totalOverride != null) total = totalOverride;
    if (!choices.length) return '';
    let acc = 0;
    const parts = [];
    if (total <= 0) {
      parts.push('#e0e0e0 0 100%');
    } else {
      choices.forEach(function (c, i) {
        const n = parseInt(choiceCounts[c], 10) || 0;
        const start = (acc / total) * 100;
        acc += n;
        const end = (acc / total) * 100;
        parts.push(PIE_COLORS[i % PIE_COLORS.length] + ' ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%');
      });
    }
    let legend = '<ul class="live-poll-legend">';
    choices.forEach(function (c, i) {
      const n = parseInt(choiceCounts[c], 10) || 0;
      const pct = total > 0 ? Math.round((n / total) * 100) : 0;
      const isOwn = ownAnswer != null && String(ownAnswer) === String(c);
      legend += '<li class="' + (isOwn ? 'is-own' : '') + '">'
        + '<span class="live-poll-swatch" style="background:' + PIE_COLORS[i % PIE_COLORS.length] + '"></span>'
        + '<strong>' + escapeHtml_(c) + '</strong>'
        + '<span>' + pct + '%（' + n + '）</span>'
        + (isOwn ? '<em>あなたの回答</em>' : '')
        + '</li>';
    });
    legend += '</ul>';
    return '<div class="live-poll-pie-wrap">'
      + '<div class="live-poll-pie" style="background:conic-gradient(' + parts.join(',') + ')"></div>'
      + legend
      + '</div>';
  }

  function writtenListHtml_(groups, ownAnswer, revealed) {
    groups = groups || [];
    const ownNorm = normalizeText_(ownAnswer);
    if (!groups.length) {
      return '<p class="filter-axis-hint">記述回答はまだありません</p>';
    }
    let html = '<ul class="live-poll-written-list">';
    groups.forEach(function (g) {
      const text = g.text || '';
      const isOwn = ownNorm && normalizeText_(text) === ownNorm;
      html += '<li class="' + (isOwn ? 'is-own' : '') + '">'
        + '<span class="live-poll-written-text">' + escapeHtml_(text) + '</span>'
        + '<span class="live-poll-written-count">' + (g.count || 0) + '件</span>'
        + (isOwn ? '<em>あなたの回答</em>' : '')
        + '</li>';
    });
    html += '</ul>';
    return html;
  }

  function judgeHtml_(ownAnswer, revealed, type) {
    if (revealed == null || revealed === '') return '';
    if (ownAnswer == null || String(ownAnswer).trim() === '') {
      return '<p class="live-poll-judge is-miss">未回答 × 正解: ' + escapeHtml_(revealed) + '</p>';
    }
    let ok;
    if (type === 'written') ok = normalizeText_(ownAnswer) === normalizeText_(revealed);
    else ok = String(ownAnswer) === String(revealed);
    if (ok) return '<p class="live-poll-judge is-ok">○ 正解</p>';
    return '<p class="live-poll-judge is-miss">× 不正解（正解: ' + escapeHtml_(revealed) + '）</p>';
  }

  function tallyFromEntries_(pub, entries) {
    const round = parseInt(pub.ballotRound, 10) || 0;
    const out = {};
    (pub.questions || []).forEach(function (q) {
      const choiceCounts = {};
      if (q.type === 'choice' && q.choices) {
        q.choices.forEach(function (c) { choiceCounts[c] = 0; });
      }
      const writtenMap = {};
      let total = 0;
      (entries || []).forEach(function (e) {
        const poll = (e && e.poll) || {};
        if ((parseInt(poll.round, 10) || 0) !== round) return;
        const ans = poll.answers && poll.answers[q.id];
        if (ans == null || String(ans).trim() === '') return;
        total += 1;
        if (q.type === 'written') {
          const key = normalizeText_(ans);
          if (!key) return;
          if (!writtenMap[key]) writtenMap[key] = { text: String(ans).trim(), count: 0 };
          writtenMap[key].count += 1;
        } else {
          choiceCounts[String(ans)] = (choiceCounts[String(ans)] || 0) + 1;
        }
      });
      out[q.id] = {
        total: total,
        choiceCounts: choiceCounts,
        writtenGroups: Object.keys(writtenMap).map(function (k) { return writtenMap[k]; })
          .sort(function (a, b) {
            if (b.count !== a.count) return b.count - a.count;
            return String(a.text).localeCompare(String(b.text), 'ja');
          })
      };
    });
    return out;
  }

  function submittedCount_(pub, entries) {
    const round = parseInt(pub.ballotRound, 10) || 0;
    const ids = pub.visibleQuestionIds && pub.visibleQuestionIds.length
      ? pub.visibleQuestionIds
      : (pub.questions || []).map(function (q) { return q.id; });
    let n = 0;
    (entries || []).forEach(function (e) {
      const poll = (e && e.poll) || {};
      if ((parseInt(poll.round, 10) || 0) !== round) return;
      const answers = poll.answers || {};
      let ok = false;
      ids.forEach(function (id) {
        if (answers[id] != null && String(answers[id]).trim() !== '') ok = true;
      });
      if (ok) n += 1;
    });
    return n;
  }

  async function control_(cmd, extra) {
    if (!window.LiveRoomModule || typeof LiveRoomModule.apiPost !== 'function') {
      throw new Error('授業ライブモジュールが未初期化です');
    }
    const room = LiveRoomModule.getActiveRoom();
    if (!room || !room.isTeacher) throw new Error('ホストのみ操作できます');
    const payload = Object.assign({ action: 'livePollControl', pin: room.pin, cmd: cmd }, extra || {});
    const res = await LiveRoomModule.apiPost(payload);
    return (res && res.data) || {};
  }

  function setHostOpen_(open) {
    hostOpen_ = !!open;
    const screen = el_('live-poll-host-screen');
    if (screen) {
      screen.style.display = open ? 'flex' : 'none';
      screen.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    document.body.classList.toggle('live-poll-host-active', !!open);
    if (!open) stopCollectTimer_();
  }

  function setStudentOpen_(open) {
    studentOpen_ = !!open;
    const screen = el_('live-poll-student-screen');
    if (screen) {
      screen.style.display = open ? 'flex' : 'none';
      screen.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    document.body.classList.toggle('live-poll-student-active', !!open);
    if (!open) {
      studentSig_ = '';
      stopCollectTimer_();
    }
  }

  function paintTimer_(endsAt) {
    const hostEl = el_('live-poll-host-timer');
    const stuEl = el_('live-poll-student-timer');
    let text = '';
    let urgent = false;
    if (endsAt) {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      text = left > 0 ? ('残り ' + formatLimit_(left)) : '終了';
      urgent = left > 0 && left <= 10;
    }
    [hostEl, stuEl].forEach(function (el) {
      if (!el) return;
      el.textContent = text;
      el.classList.toggle('is-urgent', urgent);
      el.hidden = !text;
    });
  }

  function stopCollectTimer_() {
    if (collectTimerId_) {
      clearInterval(collectTimerId_);
      collectTimerId_ = null;
    }
  }

  function startCollectTimer_(endsAt, autoEnd) {
    stopCollectTimer_();
    if (!endsAt) {
      paintTimer_(0);
      return;
    }
    function tick() {
      paintTimer_(endsAt);
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (left <= 0) {
        stopCollectTimer_();
        if (autoEnd && hostOpen_) {
          const pub = pub_(lastHostSnap_);
          const round = parseInt(pub.ballotRound, 10) || 0;
          if (pub.phase === 'collecting' && hostEndedForRound_ !== round) {
            hostEndedForRound_ = round;
            control_('endCollect').catch(function (e) {
              console.warn('投票 自動打ち切り:', e.message || e);
            });
          }
        }
      }
    }
    tick();
    collectTimerId_ = setInterval(tick, 250);
  }

  function renderHost_(snap) {
    lastHostSnap_ = snap;
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom();
    const pub = pub_(snap);
    const pinEl = el_('live-poll-host-pin');
    const titleEl = el_('live-poll-host-title');
    const phaseEl = el_('live-poll-host-phase');
    const countsEl = el_('live-poll-host-counts');
    const qEl = el_('live-poll-host-question');
    const tallyEl = el_('live-poll-host-tally');
    const revealEl = el_('live-poll-host-reveal');
    if (pinEl) pinEl.textContent = (room && room.pin) || (snap && snap.pin) || '----';
    if (titleEl) titleEl.textContent = (room && room.title) || (snap && snap.title) || 'リアルタイム投票';
    if (phaseEl) phaseEl.textContent = phaseLabel_(pub.phase);
    const joined = snap.joinedCount || (snap.entries && snap.entries.length) || 0;
    const roster = snap.rosterCount || (room && room.rosterCount) || 0;
    const submitted = pub.phase === 'collecting'
      ? submittedCount_(pub, snap.entries)
      : (parseInt(pub.submittedCount, 10) || 0);
    if (countsEl) {
      countsEl.textContent = '提出 ' + submitted + ' / 参加 ' + joined
        + (roster ? (' / 名簿 ' + roster) : '');
    }

    const q = currentQuestion_(pub);
    if (qEl) {
      if (!q) qEl.innerHTML = '<p class="filter-axis-hint">記号セットを選んで「この1問を出す」を押してください。問題文はスライド側に出します。</p>';
      else {
        qEl.innerHTML = '<div class="live-poll-q-label">' + escapeHtml_(q.label) + '</div>'
          + (q.type === 'written'
            ? '<p class="filter-axis-hint">記述欄</p>'
            : '<div class="live-poll-choice-row">' + (q.choices || []).map(function (c) {
              return '<span class="live-poll-chip">' + escapeHtml_(c) + '</span>';
            }).join('') + '</div>');
      }
    }

    const tallySource = (pub.phase === 'collecting')
      ? tallyFromEntries_(pub, snap.entries)
      : (pub.frozenTally || {});
    if (tallyEl) {
      if (!q || pub.phase === 'idle' || pub.phase === 'prompt') {
        tallyEl.innerHTML = '';
      } else {
        const t = tallySource[q.id] || { total: 0, choiceCounts: {}, writtenGroups: [] };
        if (q.type === 'written') tallyEl.innerHTML = writtenListHtml_(t.writtenGroups, null, pub.revealed && pub.revealed[q.id]);
        else tallyEl.innerHTML = pieHtml_(t.choiceCounts, q.choices, null, t.total);
      }
    }

    if (revealEl) {
      const typingModel = document.activeElement && document.activeElement.id === 'live-poll-model-input';
      if (typingModel) {
        /* keep the input focused */
      } else if (!q || (pub.phase !== 'results' && pub.phase !== 'reveal')) {
        revealEl.innerHTML = '';
      } else if (q.type === 'written') {
        const current = (pub.revealed && pub.revealed[q.id]) || '';
        revealEl.innerHTML = '<label class="live-poll-model-label">模範解答</label>'
          + '<input type="text" id="live-poll-model-input" class="live-poll-model-input" value="'
          + escapeHtml_(current) + '" placeholder="スライドの正答">'
          + '<button type="button" class="btn-primary" id="live-poll-reveal-written-btn">模範解答を出す</button>';
        const btn = el_('live-poll-reveal-written-btn');
        if (btn) {
          btn.onclick = function () {
            const input = el_('live-poll-model-input');
            BusyButton.run(btn, function () {
              return control_('reveal', { questionId: q.id, answer: (input && input.value) || '' });
            }, '提示中…').catch(function (e) { alert(e.message || e); });
          };
        }
      } else {
        const revealed = pub.revealed && pub.revealed[q.id];
        revealEl.innerHTML = '<p class="filter-axis-hint">正答の記号をタップ（ミスタップは「やりなおす」）</p>'
          + '<div class="live-poll-choice-grid">' + (q.choices || []).map(function (c) {
            const cls = revealed === c ? ' live-poll-choice-btn is-revealed' : ' live-poll-choice-btn';
            return '<button type="button" class="btn-secondary' + cls + '" data-poll-answer="'
              + escapeHtml_(c) + '">' + escapeHtml_(c) + '</button>';
          }).join('') + '</div>';
        revealEl.querySelectorAll('[data-poll-answer]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            BusyButton.run(btn, function () {
              return control_('reveal', { questionId: q.id, answer: btn.getAttribute('data-poll-answer') });
            }, '提示中…').catch(function (e) { alert(e.message || e); });
          });
        });
      }
    }

    const collecting = pub.phase === 'collecting';
    const hasQ = !!(pub.questions && pub.questions.length);
    setBtnEnabled_('live-poll-start-improv-btn', pub.phase !== 'collecting');
    setBtnEnabled_('live-poll-start-collect-btn', hasQ && pub.phase !== 'collecting');
    setBtnEnabled_('live-poll-end-collect-btn', collecting);
    setBtnEnabled_('live-poll-show-results-btn', hasQ && pub.phase !== 'idle' && pub.phase !== 'prompt');
    setBtnEnabled_('live-poll-undo-reveal-btn', pub.phase === 'reveal');
    setBtnEnabled_('live-poll-reset-btn', pub.phase !== 'collecting');

    if (collecting && pub.collectEndsAt) startCollectTimer_(pub.collectEndsAt, true);
    else if (collecting) paintTimer_(0);
    else {
      stopCollectTimer_();
      paintTimer_(0);
    }
  }

  function setBtnEnabled_(id, on) {
    const btn = el_(id);
    if (!btn) return;
    btn.disabled = !on;
  }

  function studentOwnAnswer_(q) {
    if (!q) return '';
    if (localAnswers_ && localAnswers_[q.id] != null) return localAnswers_[q.id];
    return '';
  }

  function renderStudent_(snap) {
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom();
    const pub = pub_(snap);
    const pinEl = el_('live-poll-student-pin');
    const phaseEl = el_('live-poll-student-phase');
    const body = el_('live-poll-student-body');
    if (pinEl) pinEl.textContent = (room && room.pin) || (snap && snap.pin) || '----';
    if (phaseEl) phaseEl.textContent = phaseLabel_(pub.phase);

    const round = parseInt(pub.ballotRound, 10) || 0;
    if (round !== localRound_) {
      localRound_ = round;
      localAnswers_ = {};
    }

    const qs = visibleQuestions_(pub);
    const reviewQ = currentQuestion_(pub);
    const collecting = pub.phase === 'collecting';
    const locked = pub.phase === 'waiting' || pub.phase === 'results' || pub.phase === 'reveal';
    const showResults = pub.phase === 'results' || pub.phase === 'reveal';

    if (pub.phase === 'collecting' && pub.collectEndsAt) startCollectTimer_(pub.collectEndsAt, false);
    else if (pub.phase === 'collecting') paintTimer_(0);
    else {
      stopCollectTimer_();
      paintTimer_(0);
    }

    const sig = [pub.phase, pub.ballotRound, (pub.visibleQuestionIds || []).join(','),
      pub.reviewQuestionId, JSON.stringify(pub.revealed || {}), JSON.stringify(pub.frozenTally || {})].join('|');
    const keepWrittenFocus = collecting && document.activeElement && document.activeElement.id
      && String(document.activeElement.id).indexOf('live-poll-written-') === 0;
    if (sig === studentSig_ && keepWrittenFocus) return;
    studentSig_ = sig;
    if (!body) return;

    if (!qs.length || pub.phase === 'idle') {
      body.innerHTML = '<p class="live-poll-wait-msg">まもなく出題されます。問題はスライドを見てください。</p>';
      return;
    }

    if (pub.phase === 'prompt') {
      body.innerHTML = '<p class="live-poll-wait-msg">設問が出ています。集約開始を待ってください。</p>'
        + qs.map(function (q) { return questionBlockHtml_(q, false, false); }).join('');
      return;
    }

    if (collecting) {
      body.innerHTML = qs.map(function (q) { return questionBlockHtml_(q, true, false); }).join('');
      bindStudentInputs_(qs);
      return;
    }

    if (locked && !showResults) {
      body.innerHTML = '<p class="live-poll-wait-msg">回答を受け付けました。変更できません。</p>'
        + qs.map(function (q) { return questionBlockHtml_(q, false, true); }).join('');
      return;
    }

    if (showResults && reviewQ) {
      const t = (pub.frozenTally && pub.frozenTally[reviewQ.id]) || { total: 0, choiceCounts: {}, writtenGroups: [] };
      const own = studentOwnAnswer_(reviewQ);
      const revealed = pub.revealed && pub.revealed[reviewQ.id];
      let html = '<div class="live-poll-q-label">' + escapeHtml_(reviewQ.label) + '</div>';
      html += judgeHtml_(own, revealed, reviewQ.type);
      if (reviewQ.type === 'written') html += writtenListHtml_(t.writtenGroups, own, revealed);
      else html += pieHtml_(t.choiceCounts, reviewQ.choices, own, t.total);
      body.innerHTML = html;
      return;
    }

    body.innerHTML = qs.map(function (q) { return questionBlockHtml_(q, false, true); }).join('');
  }

  function questionBlockHtml_(q, enabled, showOwn) {
    const own = studentOwnAnswer_(q);
    let html = '<div class="live-poll-q-block" data-qid="' + escapeHtml_(q.id) + '">';
    html += '<div class="live-poll-q-label">' + escapeHtml_(q.label) + '</div>';
    if (q.type === 'written') {
      if (enabled) {
        html += '<input type="text" class="live-poll-written-input" id="live-poll-written-'
          + escapeHtml_(q.id) + '" value="' + escapeHtml_(own) + '" placeholder="回答を入力">';
      } else {
        html += '<p class="live-poll-own-answer">' + (own ? escapeHtml_(own) : '（未回答）') + '</p>';
      }
    } else {
      html += '<div class="live-poll-choice-grid">';
      (q.choices || []).forEach(function (c) {
        const sel = String(own) === String(c);
        html += '<button type="button" class="live-poll-choice-btn' + (sel ? ' is-selected' : '') + '"'
          + (enabled ? '' : ' disabled')
          + ' data-qid="' + escapeHtml_(q.id) + '" data-val="' + escapeHtml_(c) + '">'
          + escapeHtml_(c) + '</button>';
      });
      html += '</div>';
      if (showOwn && !enabled) {
        html += '<p class="live-poll-own-caption">あなたの回答: ' + (own ? escapeHtml_(own) : '未回答') + '</p>';
      }
    }
    html += '</div>';
    return html;
  }

  function bindStudentInputs_(qs) {
    document.querySelectorAll('#live-poll-student-body .live-poll-choice-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const qid = btn.getAttribute('data-qid');
        const val = btn.getAttribute('data-val');
        localAnswers_[qid] = val;
        document.querySelectorAll('#live-poll-student-body .live-poll-choice-btn[data-qid="' + qid + '"]').forEach(function (b) {
          b.classList.toggle('is-selected', b.getAttribute('data-val') === val);
        });
        submitLocal_().catch(function (e) { console.warn('投票送信:', e.message || e); });
      });
    });
    qs.forEach(function (q) {
      if (q.type !== 'written') return;
      const input = el_('live-poll-written-' + q.id);
      if (!input) return;
      input.addEventListener('input', function () {
        localAnswers_[q.id] = input.value;
      });
      input.addEventListener('change', function () {
        localAnswers_[q.id] = input.value;
        submitLocal_().catch(function (e) { console.warn('投票送信:', e.message || e); });
      });
      input.addEventListener('blur', function () {
        localAnswers_[q.id] = input.value;
        submitLocal_().catch(function (e) { console.warn('投票送信:', e.message || e); });
      });
    });
  }

  async function submitLocal_() {
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom();
    if (!room || room.isTeacher) return;
    const pub = room.pollPublic || {};
    if (pub.phase !== 'collecting') return;
    if (!window.LiveFirebase) throw new Error('Firebase モジュールがありません');
    const user = (window.AuthGateService && AuthGateService.getUser()) || {};
    await LiveFirebase.submitPollAnswers(room.pin, user, localRound_, localAnswers_);
  }

  async function subscribeHost_() {
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom();
    if (!room || !window.LiveFirebase) return;
    await LiveFirebase.subscribePoll(room.pin, true, {
      title: room.title,
      pollPublic: room.pollPublic,
      roster: null,
      rosterCount: room.rosterCount
    }, function (data) {
      if (room) {
        room.pollPublic = data.pollPublic;
        if (window.LiveRoomModule.touchActiveRoom) LiveRoomModule.touchActiveRoom(room);
      }
      if (hostOpen_) renderHost_(data);
    }, function (e) {
      console.warn('投票ホスト購読:', e.message || e);
    });
  }

  async function subscribeStudent_() {
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom();
    if (!room || !window.LiveFirebase) return;
    await LiveFirebase.subscribePoll(room.pin, false, {
      title: room.title,
      pollPublic: room.pollPublic
    }, function (data) {
      if (room) {
        room.pollPublic = data.pollPublic;
        if (window.LiveRoomModule.touchActiveRoom) LiveRoomModule.touchActiveRoom(room);
      }
      if (studentOpen_) renderStudent_(data);
    }, function (e) {
      console.warn('投票生徒購読:', e.message || e);
    });
  }

  function unsubscribe_() {
    if (window.LiveFirebase && typeof LiveFirebase.unsubscribePoll === 'function') {
      LiveFirebase.unsubscribePoll();
    }
  }

  async function openHost() {
    if (!window.LiveRoomModule || !LiveRoomModule.isAdminUser_()) {
      throw new Error('管理者のみ投票を開催できます');
    }
    const room = LiveRoomModule.getActiveRoom();
    if (!isPollRoom_(room) || !room.isTeacher) {
      throw new Error('投票ライブの部屋がありません');
    }
    setStudentOpen_(false);
    setHostOpen_(true);
    renderHost_({
      pin: room.pin,
      title: room.title,
      pollPublic: room.pollPublic || {},
      rosterCount: room.rosterCount || 0,
      joinedCount: 0,
      entries: []
    });
    await subscribeHost_();
  }

  async function openStudent() {
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom();
    if (!isPollRoom_(room) || room.isTeacher) {
      throw new Error('投票ライブに参加してから開いてください');
    }
    setHostOpen_(false);
    setStudentOpen_(true);
    localRound_ = (room.pollPublic && room.pollPublic.ballotRound) || 0;
    renderStudent_({
      pin: room.pin,
      title: room.title,
      pollPublic: room.pollPublic || {}
    });
    await subscribeStudent_();
  }

  function closeScreens() {
    setHostOpen_(false);
    setStudentOpen_(false);
    unsubscribe_();
    lastHostSnap_ = null;
  }

  function bindHostButtons_() {
    const improv = el_('live-poll-start-improv-btn');
    if (improv) {
      improv.addEventListener('click', function () {
        BusyButton.run(improv, function () {
          return control_('startImprov', { choiceSet: selectedChoiceSet_() });
        }, '出題中…').catch(function (e) { alert(e.message || e); });
      });
    }
    const startC = el_('live-poll-start-collect-btn');
    if (startC) {
      startC.addEventListener('click', function () {
        BusyButton.run(startC, function () {
          return control_('startCollect', { durationSec: collectDurationFromUi_() });
        }, '開始中…').catch(function (e) { alert(e.message || e); });
      });
    }
    const endC = el_('live-poll-end-collect-btn');
    if (endC) {
      endC.addEventListener('click', function () {
        BusyButton.run(endC, function () {
          return control_('endCollect');
        }, '打ち切り中…').catch(function (e) { alert(e.message || e); });
      });
    }
    const showR = el_('live-poll-show-results-btn');
    if (showR) {
      showR.addEventListener('click', function () {
        BusyButton.run(showR, function () {
          return control_('showResults');
        }, '表示中…').catch(function (e) { alert(e.message || e); });
      });
    }
    const undo = el_('live-poll-undo-reveal-btn');
    if (undo) {
      undo.addEventListener('click', function () {
        BusyButton.run(undo, function () {
          return control_('undoReveal');
        }, '取消中…').catch(function (e) { alert(e.message || e); });
      });
    }
    const reset = el_('live-poll-reset-btn');
    if (reset) {
      reset.addEventListener('click', function () {
        BusyButton.run(reset, function () {
          return control_('resetQuestion');
        }, '切替中…').catch(function (e) { alert(e.message || e); });
      });
    }
    const back = el_('live-poll-host-back-btn');
    if (back) {
      back.addEventListener('click', function () {
        setHostOpen_(false);
        unsubscribe_();
        if (window.LiveRoomModule && LiveRoomModule.refreshUi_) LiveRoomModule.refreshUi_();
      });
    }
    const closeBtn = el_('live-poll-host-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (!window.confirm('投票ライブの部屋を閉じますか？（参加コードは無効になります）')) return;
        BusyButton.run(closeBtn, function () {
          return LiveRoomModule.closeRoom();
        }, '終了中…').catch(function (e) { alert(e.message || e); });
      });
    }
    const stuBack = el_('live-poll-student-back-btn');
    if (stuBack) {
      stuBack.addEventListener('click', function () {
        setStudentOpen_(false);
        unsubscribe_();
        if (window.LiveRoomModule && LiveRoomModule.refreshUi_) LiveRoomModule.refreshUi_();
      });
    }
  }

  function init() {
    bindHostButtons_();
  }

  return {
    init: init,
    openHost: openHost,
    openStudent: openStudent,
    closeScreens: closeScreens,
    isPollRoom: isPollRoom_,
    isHostOpen: function () { return hostOpen_; },
    isStudentOpen: function () { return studentOpen_; }
  };
})();

window.LivePollModule = LivePollModule;
