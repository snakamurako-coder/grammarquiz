/**
 * 授業ライブ — リアルタイム投票（即興 + プリセット + 準備画面）
 */
const LivePollModule = (function () {
  const PIE_COLORS = ['#1976d2', '#fb8c00', '#43a047', '#e53935', '#8e24aa', '#00838f', '#f9a825', '#5d4037', '#546e7a', '#c2185b'];
  const SEC_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  const FONT_KEY = 'dd_live_board_font_pt';
  const FONT_MIN = 1;
  const FONT_MAX = 50;
  const FONT_DEFAULT = 18;

  let hostOpen_ = false;
  let studentOpen_ = false;
  let setupOpen_ = false;
  let lastHostSnap_ = null;
  let localAnswers_ = {};
  let localRound_ = 0;
  let collectTimerId_ = null;
  let hostEndedForRound_ = 0;
  let studentSig_ = '';
  let selectedPresetId_ = '';
  let editingPreset_ = null;

  function el_(id) {
    return document.getElementById(id);
  }

  function loadFontPt_() {
    try {
      const n = parseInt(localStorage.getItem(FONT_KEY), 10);
      if (isNaN(n)) return FONT_DEFAULT;
      return Math.min(FONT_MAX, Math.max(FONT_MIN, n));
    } catch (e) {
      return FONT_DEFAULT;
    }
  }

  function applyFontPt_(pt, persist) {
    pt = Math.min(FONT_MAX, Math.max(FONT_MIN, parseInt(pt, 10) || FONT_DEFAULT));
    const screen = el_('live-poll-host-screen');
    if (screen) screen.style.setProperty('--live-poll-pt', String(pt));
    const input = el_('live-poll-font-input');
    if (input && String(input.value) !== String(pt)) input.value = String(pt);
    const board = el_('live-room-board-screen');
    if (board) board.style.setProperty('--live-list-pt', String(pt));
    const boardInput = el_('live-board-font-input');
    if (boardInput && String(boardInput.value) !== String(pt)) boardInput.value = String(pt);
    if (persist !== false) {
      try { localStorage.setItem(FONT_KEY, String(pt)); } catch (e) { /* ignore */ }
    }
    return pt;
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
    return (room.activity || room.mode) === 'poll';
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
      reveal: '正答提示',
      sectionWait: 'セクション間待機'
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

  function durationToMinSec_(totalSec) {
    const s = Math.max(0, parseInt(totalSec, 10) || 0);
    return { min: Math.floor(s / 60), sec: s % 60 };
  }

  function timerSecSelectHtml_(selectedSec, id) {
    let html = '<select class="live-poll-timer-input" id="' + escapeHtml_(id) + '" aria-label="秒">';
    SEC_OPTIONS.forEach(function (v) {
      html += '<option value="' + v + '"' + (v === selectedSec ? ' selected' : '') + '>' + v + '</option>';
    });
    html += '</select>';
    return html;
  }

  function timerBlockHtml_(opts) {
    opts = opts || {};
    const minId = opts.minId || 'live-poll-timer-min';
    const secId = opts.secId || 'live-poll-timer-sec';
    const ds = durationToMinSec_(opts.durationSec || 0);
    const snapSec = SEC_OPTIONS.indexOf(ds.sec) >= 0 ? ds.sec : 0;
    return '<div class="live-poll-timer-block">'
      + '<span class="live-poll-timer-label">' + escapeHtml_(opts.label || '集約タイマー') + '</span>'
      + '<div class="live-poll-timer-fields">'
      + '<label class="live-poll-timer-unit"><span>分</span>'
      + '<input type="number" class="live-poll-timer-input" id="' + escapeHtml_(minId) + '" min="0" max="30" value="'
      + ds.min + '" inputmode="numeric" aria-label="分"></label>'
      + '<label class="live-poll-timer-unit"><span>秒</span>'
      + timerSecSelectHtml_(snapSec, secId) + '</label>'
      + '</div>'
      + '<p class="live-poll-timer-hint">0分0秒は手動打ち切り</p></div>';
  }

  function readTimerDuration_(minId, secId) {
    const minEl = el_(minId);
    const secEl = el_(secId);
    const mins = Math.max(0, parseInt(minEl && minEl.value, 10) || 0);
    const secs = Math.max(0, parseInt(secEl && secEl.value, 10) || 0);
    return mins * 60 + secs;
  }

  function collectDurationFromUi_() {
    return readTimerDuration_('live-poll-timer-min', 'live-poll-timer-sec');
  }

  function choiceSets_() {
    return window.LivePollChoiceSets;
  }

  function readImprovChoiceConfig_() {
    const CS = choiceSets_();
    const kindEl = el_('live-poll-choice-kind');
    const countEl = el_('live-poll-choice-count');
    const customEl = el_('live-poll-custom-choices');
    const kind = (kindEl && kindEl.value) || 'ABC';
    return {
      choiceSet: kind,
      choiceCount: parseInt(countEl && countEl.value, 10) || (CS ? CS.defaultCount(kind) : 3),
      customChoices: (customEl && customEl.value) || ''
    };
  }

  function syncImprovChoiceUi_() {
    const CS = choiceSets_();
    if (!CS) return;
    const kindEl = el_('live-poll-choice-kind');
    const countWrap = el_('live-poll-choice-count-wrap');
    const countEl = el_('live-poll-choice-count');
    const customWrap = el_('live-poll-custom-choices-wrap');
    const previewEl = el_('live-poll-choice-preview');
    const kind = (kindEl && kindEl.value) || 'ABC';
    const showCount = CS.needsCount(kind);
    const showCustom = CS.needsCustom(kind);
    if (countWrap) countWrap.style.display = showCount ? '' : 'none';
    if (customWrap) customWrap.style.display = showCustom ? '' : 'none';
    if (countEl && showCount) {
      countEl.max = String(CS.maxCount(kind));
      if (parseInt(countEl.value, 10) > CS.maxCount(kind)) countEl.value = String(CS.maxCount(kind));
      if (parseInt(countEl.value, 10) < 2) countEl.value = String(CS.defaultCount(kind));
    }
    if (previewEl) previewEl.textContent = CS.previewText(readImprovChoiceConfig_());
  }

  function initImprovChoiceUi_() {
    const CS = choiceSets_();
    const kindEl = el_('live-poll-choice-kind');
    if (!CS || !kindEl) return;
    if (!kindEl.options.length) {
      kindEl.innerHTML = CS.kindOptionsHtml('ABC');
    }
    if (!kindEl.dataset.bound) {
      kindEl.dataset.bound = '1';
      kindEl.addEventListener('change', syncImprovChoiceUi_);
      const countEl = el_('live-poll-choice-count');
      const customEl = el_('live-poll-custom-choices');
      if (countEl) countEl.addEventListener('input', syncImprovChoiceUi_);
      if (customEl) customEl.addEventListener('input', syncImprovChoiceUi_);
    }
    syncImprovChoiceUi_();
  }

  function validateImprovChoice_() {
    const CS = choiceSets_();
    if (!CS) return { ok: true, config: readImprovChoiceConfig_() };
    return CS.validate(readImprovChoiceConfig_());
  }

  function getContinueChecked_() {
    const hostCb = el_('live-poll-continue-modes');
    const setupCb = el_('live-poll-setup-continue-modes');
    if (setupOpen_ && setupCb) return !!setupCb.checked;
    if (hostOpen_ && hostCb) return !!hostCb.checked;
    if (setupCb) return !!setupCb.checked;
    return true;
  }

  const BLANK_COLOR = '#b0bec5';
  const INCLUDE_BLANK_KEY = 'dd_live_poll_include_blank';

  function includeBlank_() {
    const cb = el_('live-poll-include-blank');
    if (cb) return !!cb.checked;
    try { return localStorage.getItem(INCLUDE_BLANK_KEY) === '1'; } catch (e) { return false; }
  }

  function saveIncludeBlank_(on) {
    try { localStorage.setItem(INCLUDE_BLANK_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function syncIncludeBlankUi_() {
    const cb = el_('live-poll-include-blank');
    if (!cb) return includeBlank_();
    let on = false;
    try { on = localStorage.getItem(INCLUDE_BLANK_KEY) === '1'; } catch (e) { on = false; }
    if (cb.checked !== on) cb.checked = on;
    return !!cb.checked;
  }

  function shareItems_(q, tally, joined, includeBlank) {
    q = q || {};
    tally = tally || {};
    joined = Math.max(0, parseInt(joined, 10) || 0);
    const answered = parseInt(tally.total, 10) || 0;
    const blank = Math.max(0, joined - answered);
    const items = [];
    if (q.type === 'written') {
      (tally.writtenGroups || []).forEach(function (g, i) {
        items.push({
          label: g.text || '',
          count: parseInt(g.count, 10) || 0,
          color: PIE_COLORS[i % PIE_COLORS.length]
        });
      });
    } else {
      (q.choices || []).forEach(function (c, i) {
        items.push({
          label: String(c),
          count: parseInt((tally.choiceCounts || {})[c], 10) || 0,
          color: PIE_COLORS[i % PIE_COLORS.length]
        });
      });
    }
    const shown = items.reduce(function (s, it) { return s + it.count; }, 0);
    const other = Math.max(0, answered - shown);
    if (other > 0) {
      items.push({ label: 'その他', count: other, color: '#90a4ae' });
    }
    if (includeBlank) {
      items.push({ label: '未回答', count: blank, color: BLANK_COLOR, isBlank: true });
    }
    const base = includeBlank ? joined : answered;
    items.forEach(function (it) {
      it.pct = base > 0 ? (it.count / base) * 100 : 0;
    });
    return {
      items: items,
      base: base,
      answered: answered,
      blank: blank,
      joined: joined
    };
  }

  function chartHeadHtml_(q, share) {
    return '<div class="live-poll-chart-head">'
      + '<span class="live-poll-q-label">' + escapeHtml_((q && q.label) || '') + '</span>'
      + '<span class="live-poll-answered-count" title="この設問の解答済み / 参加者数">'
      + share.answered + ' / ' + share.joined + '</span>'
      + '</div>';
  }

  function barLegendHtml_(share) {
    let html = '<div class="live-poll-bar-legend">';
    (share.items || []).forEach(function (it) {
      html += '<span class="live-poll-bar-legend-item' + (it.isBlank ? ' is-blank' : '') + '">'
        + '<span class="live-poll-swatch" style="background:' + it.color + '"></span>'
        + '<strong>' + escapeHtml_(it.label) + '</strong>'
        + '<span>' + Math.round(it.pct || 0) + '%（' + it.count + '）</span>'
        + '</span>';
    });
    html += '</div>';
    return html;
  }

  function legendHtml_(share, ownAnswer) {
    const own = ownAnswer == null ? '' : String(ownAnswer);
    let legend = '<ul class="live-poll-legend">';
    (share.items || []).forEach(function (it) {
      const pct = Math.round(it.pct || 0);
      const isOwn = !it.isBlank && own && own === String(it.label);
      legend += '<li class="' + (isOwn ? 'is-own' : '') + (it.isBlank ? ' is-blank' : '') + '">'
        + '<span class="live-poll-swatch" style="background:' + it.color + '"></span>'
        + '<strong>' + escapeHtml_(it.label) + '</strong>'
        + '<span>' + pct + '%（' + it.count + '）</span>'
        + (isOwn ? '<em>あなたの回答</em>' : '')
        + '</li>';
    });
    legend += '</ul>';
    return legend;
  }

  function pieFromShare_(share, ownAnswer) {
    const items = share.items || [];
    const base = share.base || 0;
    let acc = 0;
    const parts = [];
    if (base <= 0) {
      parts.push('#e0e0e0 0 100%');
    } else {
      items.forEach(function (it) {
        const start = (acc / base) * 100;
        acc += it.count;
        const end = (acc / base) * 100;
        if (end > start) {
          parts.push(it.color + ' ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%');
        }
      });
      if (!parts.length) parts.push('#e0e0e0 0 100%');
    }
    return '<div class="live-poll-pie-wrap">'
      + '<div class="live-poll-pie" style="background:conic-gradient(' + parts.join(',') + ')"></div>'
      + legendHtml_(share, ownAnswer)
      + '</div>';
  }

  function barFromShare_(share) {
    const items = (share.items || []).filter(function (it) { return it.count > 0; });
    let html = '';
    if (!items.length) {
      html = '<div class="live-poll-bar live-poll-bar-empty" aria-label="まだ回答がありません"></div>';
    } else {
      html = '<div class="live-poll-bar" role="img" aria-label="回答の割合">';
      items.forEach(function (it) {
        const pct = it.pct || 0;
        const show = pct >= 8;
        html += '<span class="live-poll-bar-seg' + (it.isBlank ? ' is-blank' : '') + '" style="flex:'
          + it.count + ' 0 0;background:' + it.color + '" title="'
          + escapeHtml_(it.label + ' ' + Math.round(pct) + '%（' + it.count + '）') + '">'
          + (show ? escapeHtml_(it.label + ' ' + Math.round(pct) + '%') : '')
          + '</span>';
      });
      html += '</div>';
    }
    return html + barLegendHtml_(share);
  }

  function pieHtml_(choiceCounts, choices, ownAnswer, totalOverride, opts) {
    choices = choices || [];
    choiceCounts = choiceCounts || {};
    opts = opts || {};
    let answered = 0;
    choices.forEach(function (c) {
      answered += parseInt(choiceCounts[c], 10) || 0;
    });
    if (totalOverride != null) answered = parseInt(totalOverride, 10) || 0;
    const q = { type: 'choice', choices: choices };
    const tally = { total: answered, choiceCounts: choiceCounts };
    const joined = opts.joined != null ? opts.joined : answered;
    const share = shareItems_(q, tally, joined, !!opts.includeBlank);
    return pieFromShare_(share, ownAnswer);
  }

  function hostQuestionTallyHtml_(q, tally, joined, includeBlank, mode) {
    const share = shareItems_(q, tally, joined, includeBlank);
    let html = '<div class="live-poll-chart-block">' + chartHeadHtml_(q, share);
    if (mode === 'bar') html += barFromShare_(share);
    else if (q.type === 'written') {
      html += writtenListHtml_(tally && tally.writtenGroups, null, null, {
        includeBlank: includeBlank,
        joined: joined,
        answered: share.answered
      });
    } else html += pieFromShare_(share, null);
    html += '</div>';
    return html;
  }

  function writtenListHtml_(groups, ownAnswer, revealed, opts) {
    groups = groups || [];
    opts = opts || {};
    const ownNorm = normalizeText_(ownAnswer);
    let html = '';
    if (!groups.length) {
      html = '<p class="filter-axis-hint">記述回答はまだありません</p>';
    } else {
      html = '<ul class="live-poll-written-list">';
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
    }
    if (opts.includeBlank && opts.joined != null) {
      const answered = opts.answered != null ? opts.answered : groups.reduce(function (s, g) {
        return s + (parseInt(g.count, 10) || 0);
      }, 0);
      const blank = Math.max(0, (parseInt(opts.joined, 10) || 0) - answered);
      const base = parseInt(opts.joined, 10) || 0;
      const pct = base > 0 ? Math.round((blank / base) * 100) : 0;
      html += '<p class="live-poll-blank-note">未回答 ' + blank + '名（' + pct + '%）</p>';
    }
    return html;
  }

  function parseAnswerList_(raw) {
    const CS = choiceSets_();
    if (CS && typeof CS.parseAnswerList === 'function') return CS.parseAnswerList(raw);
    if (raw == null || raw === '') return [];
    if (Array.isArray(raw)) return raw.map(function (s) { return String(s).trim(); }).filter(Boolean);
    return [String(raw).trim()].filter(Boolean);
  }

  function formatAnswerList_(raw) {
    return parseAnswerList_(raw).join(' / ');
  }

  function judgeHtml_(ownAnswer, revealed, type) {
    const list = parseAnswerList_(revealed);
    if (!list.length) return '';
    const shown = formatAnswerList_(list);
    if (ownAnswer == null || String(ownAnswer).trim() === '') {
      return '<p class="live-poll-judge is-miss">未回答 × 正解: ' + escapeHtml_(shown) + '</p>';
    }
    let ok;
    if (type === 'written') {
      ok = list.some(function (ans) { return normalizeText_(ownAnswer) === normalizeText_(ans); });
    } else {
      ok = list.indexOf(String(ownAnswer)) >= 0;
    }
    if (ok) return '<p class="live-poll-judge is-ok">○ 正解</p>';
    return '<p class="live-poll-judge is-miss">× 不正解（正解: ' + escapeHtml_(shown) + '）</p>';
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

  function loadPollBestN_() {
    if (window.LiveRoomModule && typeof LiveRoomModule.getBestN === 'function') {
      return LiveRoomModule.getBestN();
    }
    try {
      const n = parseInt(localStorage.getItem('dd_live_board_best_n'), 10);
      if (isNaN(n)) return 8;
      return Math.min(200, Math.max(1, n));
    } catch (e) {
      return 8;
    }
  }

  function pollSubmitTs_(poll) {
    return parseInt((poll && (poll.submittedAt || poll.updatedAt)), 10) || 0;
  }

  function pollElapsedSec_(pub, poll) {
    const t = pollSubmitTs_(poll);
    if (!t) return 0;
    let start = parseInt(pub && pub.collectStartedAt, 10) || 0;
    if (!start) {
      const ends = parseInt(pub && pub.collectEndsAt, 10) || 0;
      const dur = parseInt(pub && pub.collectDurationSec, 10) || 0;
      if (ends && dur) start = ends - dur * 1000;
    }
    if (start && t >= start) return (t - start) / 1000;
    return 0;
  }

  function formatPollTime_(sec) {
    const n = Number(sec);
    if (!n || !isFinite(n) || n <= 0) return '—';
    const m = Math.floor(n / 60);
    const r = n - m * 60;
    return m > 0 ? (m + '分' + r.toFixed(1) + '秒') : (r.toFixed(1) + '秒');
  }

  function pollAnswerOf_(entry, q, round) {
    const poll = (entry && entry.poll) || {};
    if ((parseInt(poll.round, 10) || 0) !== round) return '';
    if (!q) return '';
    const ans = poll.answers && poll.answers[q.id];
    return ans == null ? '' : String(ans);
  }

  function pollIsCorrect_(answer, revealed, type) {
    const list = parseAnswerList_(revealed);
    if (!list.length) return false;
    if (answer == null || String(answer).trim() === '') return false;
    if (type === 'written') {
      return list.some(function (ans) { return normalizeText_(answer) === normalizeText_(ans); });
    }
    return list.indexOf(String(answer)) >= 0;
  }

  function pollRestHtml_(extraSubmitted, pendingCount, hasNamed) {
    if (!extraSubmitted && !pendingCount) return '';
    let html = '<div class="live-poll-rest">';
    if (extraSubmitted) {
      html += '<div class="live-poll-rest-row">' + (hasNamed ? 'ほか提出 ' : '提出 ')
        + extraSubmitted + '名</div>';
    }
    if (pendingCount) html += '<div class="live-poll-rest-row">参加中 ' + pendingCount + '名</div>';
    return html + '</div>';
  }

  function renderHostRoster_(snap, pub) {
    const el = el_('live-poll-host-roster');
    if (!el) return;
    const entries = (snap && snap.entries) || [];
    if (!entries.length) {
      el.innerHTML = '<p class="filter-axis-hint" style="margin:0;">まだ参加者はいません</p>';
      return;
    }
    const q = currentQuestion_(pub);
    const round = parseInt(pub.ballotRound, 10) || 0;
    const revealed = q && pub.revealed && pub.revealed[q.id];
    const canJudge = !!(q && parseAnswerList_(revealed).length);
    const limit = loadPollBestN_();
    const submitted = [];
    const correct = [];
    entries.forEach(function (e) {
      const poll = (e && e.poll) || {};
      const answer = pollAnswerOf_(e, q, round);
      const hasAns = !!(answer && String(answer).trim());
      if (!hasAns) return;
      const row = {
        account: e.account,
        name: e.name,
        number: e.number,
        ts: pollSubmitTs_(poll),
        elapsed: pollElapsedSec_(pub, poll),
        correct: canJudge && pollIsCorrect_(answer, revealed, q.type)
      };
      submitted.push(row);
      if (row.correct) correct.push(row);
    });
    correct.sort(function (a, b) {
      if (a.ts !== b.ts) {
        if (!a.ts) return 1;
        if (!b.ts) return -1;
        return a.ts - b.ts;
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
    });
    const shown = canJudge ? correct.slice(0, limit) : [];
    const extraSubmitted = Math.max(0, submitted.length - shown.length);
    const pendingCount = Math.max(0, entries.length - submitted.length);
    let html = '';
    if (shown.length) {
      html += '<table class="live-poll-roster-table"><thead><tr>'
        + '<th>#</th><th>番号</th><th>氏名</th><th>タイム</th>'
        + '</tr></thead><tbody>';
      shown.forEach(function (row, idx) {
        html += '<tr><td>' + (idx + 1) + '</td><td>'
          + escapeHtml_(row.number || '—') + '</td><td>'
          + escapeHtml_(row.name || '—') + '</td><td>'
          + escapeHtml_(formatPollTime_(row.elapsed)) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += pollRestHtml_(extraSubmitted, pendingCount, !!shown.length);
    el.innerHTML = html || '<p class="filter-axis-hint" style="margin:0;">まだ参加者はいません</p>';
  }

  async function control_(cmd, extra) {
    if (!window.LiveRoomModule || typeof LiveRoomModule.apiPost !== 'function') {
      throw new Error('授業ライブモジュールが未初期化です');
    }
    const room = LiveRoomModule.getActiveRoom();
    if (!room || !room.isTeacher) throw new Error('ホストのみ操作できます');
    const payload = Object.assign({ action: 'livePollControl', pin: room.pin, cmd: cmd }, extra || {});
    const res = await LiveRoomModule.apiPost(payload);
    const data = (res && res.data) || {};
    if (data.pollPublic && room) {
      room.pollPublic = data.pollPublic;
      if (data.activity) room.activity = data.activity;
      LiveRoomModule.touchActiveRoom(room);
    }
    return data;
  }

  function setSetupOpen_(open) {
    setupOpen_ = !!open;
    const screen = el_('live-poll-setup-screen');
    if (screen) {
      screen.style.display = open ? 'flex' : 'none';
      screen.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    document.body.classList.toggle('live-poll-setup-active', !!open);
  }

  function setHostOpen_(open) {
    hostOpen_ = !!open;
    const screen = el_('live-poll-host-screen');
    if (screen) {
      screen.style.display = open ? 'flex' : 'none';
      screen.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    document.body.classList.toggle('live-poll-host-active', !!open);
    if (open) applyFontPt_(loadFontPt_(), false);
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

  function paintSetupRoomInfo_() {
    const info = el_('live-poll-setup-room-info');
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom();
    if (!info) return;
    if (room && room.isTeacher) {
      info.textContent = '開催中 PIN ' + room.pin + ' — ' + (room.title || 'リアルタイム投票');
    } else {
      info.textContent = '実施開始時に PIN 部屋を開きます（継続チェック時は既存 PIN を利用）';
    }
  }

  async function renderPresetList_() {
    const listEl = el_('live-poll-preset-list');
    const runBtn = el_('live-poll-run-preset-btn');
    if (!listEl || !window.LivePollPresetStore) return;
    const rows = await LivePollPresetStore.listPresets();
    if (!rows.length) {
      listEl.innerHTML = '<li><span class="filter-axis-hint">プリセットがありません。「新規プリセット」で作成してください。</span></li>';
      if (runBtn) runBtn.disabled = true;
      selectedPresetId_ = '';
      return;
    }
    listEl.innerHTML = rows.map(function (p) {
      const secN = (p.sections || []).length;
      const qN = (p.sections || []).reduce(function (n, s) {
        return n + ((s.questions || []).length);
      }, 0);
      const checked = p.id === selectedPresetId_ ? ' checked' : '';
      return '<li><label><input type="radio" name="live-poll-preset-pick" value="' + escapeHtml_(p.id) + '"' + checked + '>'
        + escapeHtml_(p.name) + '</label>'
        + '<span class="filter-axis-hint">' + secN + ' セクション / ' + qN + ' 問</span>'
        + '<button type="button" class="btn-secondary live-poll-preset-edit-btn" data-preset-id="' + escapeHtml_(p.id) + '">編集</button></li>';
    }).join('');
    if (!selectedPresetId_ && rows[0]) selectedPresetId_ = rows[0].id;
    const picked = listEl.querySelector('input[name="live-poll-preset-pick"]:checked');
    if (picked) selectedPresetId_ = picked.value;
    if (runBtn) runBtn.disabled = !selectedPresetId_;
    listEl.querySelectorAll('input[name="live-poll-preset-pick"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        selectedPresetId_ = radio.value;
        if (runBtn) runBtn.disabled = !selectedPresetId_;
      });
    });
    listEl.querySelectorAll('.live-poll-preset-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openPresetEditor_(btn.getAttribute('data-preset-id'));
      });
    });
  }

  function showEditorView_(on) {
    const listView = el_('live-poll-setup-list-view');
    const editorView = el_('live-poll-setup-editor-view');
    if (listView) listView.style.display = on ? 'none' : '';
    if (editorView) editorView.style.display = on ? '' : 'none';
  }

  function choiceSetOptionsHtml_(selected) {
    const CS = choiceSets_();
    if (CS) return CS.kindOptionsHtml(selected);
    return '<option value="ABC">ABC</option>';
  }

  function rowChoiceConfig_(row) {
    const kindEl = row.querySelector('[data-field="choiceSet"]');
    const countEl = row.querySelector('[data-field="choiceCount"]');
    const customEl = row.querySelector('[data-field="customChoices"]');
    return {
      choiceSet: (kindEl && kindEl.value) || 'ABC',
      choiceCount: parseInt(countEl && countEl.value, 10) || 0,
      customChoices: (customEl && customEl.value) || ''
    };
  }

  function selectedAnswersFromRow_(row) {
    try {
      return parseAnswerList_(JSON.parse(row.getAttribute('data-answers') || '[]'));
    } catch (e) {
      return parseAnswerList_(row.getAttribute('data-answers') || '');
    }
  }

  function setRowAnswers_(row, list) {
    row.setAttribute('data-answers', JSON.stringify(parseAnswerList_(list)));
  }

  function paintRowAnswerChips_(row) {
    const CS = choiceSets_();
    const wrap = row.querySelector('[data-field="answer-picks"]');
    const written = row.querySelector('[data-field="answer"]');
    const hint = row.querySelector('[data-field="answer-hint"]');
    if (!wrap) return;
    const kind = (row.querySelector('[data-field="choiceSet"]') || {}).value || 'ABC';
    const isWritten = CS ? CS.isWritten(kind) : kind === 'WRITTEN';
    if (isWritten) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      if (written) written.style.display = '';
      if (hint) hint.textContent = '模範解答を入力';
      return;
    }
    if (written) written.style.display = 'none';
    wrap.style.display = '';
    const choices = CS ? CS.buildChoices(rowChoiceConfig_(row)) : [];
    let selected = selectedAnswersFromRow_(row).filter(function (a) { return choices.indexOf(a) >= 0; });
    setRowAnswers_(row, selected);
    wrap.innerHTML = choices.map(function (c) {
      const on = selected.indexOf(c) >= 0;
      return '<button type="button" class="live-poll-choice-btn' + (on ? ' is-selected' : '') + '" data-val="'
        + escapeHtml_(c) + '">' + escapeHtml_(c) + '</button>';
    }).join('');
    if (hint) {
      hint.textContent = choices.length
        ? '正答をタップ（複数可）' + (selected.length ? '　選択中: ' + selected.join(' / ') : '')
        : '選択肢を設定してください';
    }
    wrap.querySelectorAll('button[data-val]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const val = btn.getAttribute('data-val');
        let sel = selectedAnswersFromRow_(row);
        const i = sel.indexOf(val);
        if (i >= 0) sel.splice(i, 1);
        else sel.push(val);
        setRowAnswers_(row, sel);
        paintRowAnswerChips_(row);
      });
    });
  }

  function syncEditorRowChoiceUi_(row) {
    const CS = choiceSets_();
    if (!CS || !row) return;
    const kindEl = row.querySelector('[data-field="choiceSet"]');
    const countEl = row.querySelector('[data-field="choiceCount"]');
    const customEl = row.querySelector('[data-field="customChoices"]');
    const kind = (kindEl && kindEl.value) || 'ABC';
    const showCount = CS.needsCount(kind);
    const showCustom = CS.needsCustom(kind);
    if (countEl) {
      countEl.style.display = showCount ? '' : 'none';
      if (showCount) {
        countEl.max = String(CS.maxCount(kind));
        const n = parseInt(countEl.value, 10);
        if (isNaN(n) || n < 2) countEl.value = String(CS.defaultCount(kind));
        if (n > CS.maxCount(kind)) countEl.value = String(CS.maxCount(kind));
      }
    }
    if (customEl) customEl.style.display = showCustom ? '' : 'none';
    paintRowAnswerChips_(row);
  }

  function bindEditorRowChoiceUi_(wrap) {
    if (!wrap) return;
    wrap.querySelectorAll('.live-poll-q-editor-row').forEach(function (row) {
      syncEditorRowChoiceUi_(row);
      row.querySelectorAll('[data-field="choiceSet"], [data-field="choiceCount"], [data-field="customChoices"]').forEach(function (input) {
        input.addEventListener('change', function () { syncEditorRowChoiceUi_(row); });
        input.addEventListener('input', function () { syncEditorRowChoiceUi_(row); });
      });
    });
  }

  function persistEditorToModel_() {
    if (!editingPreset_ || !el_('live-poll-editor-sections')) return editingPreset_;
    if (!el_('live-poll-editor-sections').querySelector('.live-poll-editor-section')) return editingPreset_;
    editingPreset_ = readPresetFromEditor_();
    return editingPreset_;
  }

  function renderPresetEditor_() {
    const wrap = el_('live-poll-editor-sections');
    const nameEl = el_('live-poll-editor-name');
    if (!wrap || !editingPreset_) return;
    if (nameEl) nameEl.value = editingPreset_.name || '';
    wrap.innerHTML = (editingPreset_.sections || []).map(function (sec, si) {
      const tMinId = 'live-poll-sec-min-' + si;
      const tSecId = 'live-poll-sec-sec-' + si;
      let qRows = (sec.questions || []).map(function (q, qi) {
        const CS = choiceSets_();
        const kind = CS ? CS.normalizeKind(q.choiceSet || 'ABC') : (q.choiceSet || 'ABC');
        const count = (parseInt(q.choiceCount, 10) > 0)
          ? parseInt(q.choiceCount, 10)
          : (CS ? CS.defaultCount(kind) : 3);
        const answers = parseAnswerList_(q.answers != null ? q.answers : q.answer);
        return '<div class="live-poll-q-editor-row" data-sec="' + si + '" data-q="' + qi + '" data-answers="'
          + escapeHtml_(JSON.stringify(answers)) + '">'
          + '<div class="live-poll-q-editor-top">'
          + '<input type="text" class="live-poll-written-input" data-field="label" value="' + escapeHtml_(q.label || '') + '" placeholder="Q1.">'
          + '<div class="live-poll-q-editor-answers">'
          + '<p class="live-poll-q-editor-hint" data-field="answer-hint"></p>'
          + '<div class="live-poll-q-editor-choices" data-field="answer-picks"></div>'
          + '<input type="text" class="live-poll-written-input" data-field="answer" value="'
          + escapeHtml_(kind === 'WRITTEN' ? (q.answer || '') : '') + '" placeholder="模範解答" style="display:none;">'
          + '</div>'
          + '<select data-field="choiceSet">' + choiceSetOptionsHtml_(kind) + '</select>'
          + '<input type="number" class="live-poll-written-input" data-field="choiceCount" min="2" max="26" value="'
          + escapeHtml_(count) + '" aria-label="選択肢の数">'
          + '<input type="text" class="live-poll-written-input" data-field="customChoices" value="'
          + escapeHtml_(q.customChoices || '') + '" placeholder="独自（,区切り）" aria-label="独自の選択肢">'
          + '<button type="button" class="btn-secondary" data-action="remove-q">削除</button>'
          + '</div>'
          + '</div>';
      }).join('');
      return '<div class="live-poll-editor-section" data-sec-index="' + si + '">'
        + '<div class="form-group"><label>セクション名</label>'
        + '<input type="text" class="live-poll-written-input" data-field="sec-name" value="' + escapeHtml_(sec.name || '') + '"></div>'
        + timerBlockHtml_({
          label: '集約タイマー（このセクション）',
          minId: tMinId,
          secId: tSecId,
          durationSec: sec.collectDurationSec || 0
        })
        + '<div class="subsection-title">設問</div>' + qRows
        + '<button type="button" class="btn-secondary" data-action="add-q">設問を追加</button>'
        + '<button type="button" class="btn-secondary" data-action="remove-sec">セクション削除</button></div>';
    }).join('');
    wrap.querySelectorAll('[data-action="add-q"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        persistEditorToModel_();
        const secEl = btn.closest('.live-poll-editor-section');
        const si = parseInt(secEl.getAttribute('data-sec-index'), 10);
        editingPreset_.sections[si].questions.push({
          label: 'Q' + (editingPreset_.sections[si].questions.length + 1) + '.',
          choiceSet: 'ABC',
          choiceCount: 3,
          customChoices: '',
          answers: [],
          answer: ''
        });
        renderPresetEditor_();
      });
    });
    wrap.querySelectorAll('[data-action="remove-q"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        persistEditorToModel_();
        const row = btn.closest('.live-poll-q-editor-row');
        const si = parseInt(row.getAttribute('data-sec'), 10);
        const qi = parseInt(row.getAttribute('data-q'), 10);
        editingPreset_.sections[si].questions.splice(qi, 1);
        renderPresetEditor_();
      });
    });
    wrap.querySelectorAll('[data-action="remove-sec"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        persistEditorToModel_();
        const secEl = btn.closest('.live-poll-editor-section');
        const si = parseInt(secEl.getAttribute('data-sec-index'), 10);
        if ((editingPreset_.sections || []).length <= 1) {
          alert('最低1セクション必要です');
          return;
        }
        editingPreset_.sections.splice(si, 1);
        renderPresetEditor_();
      });
    });
    bindEditorRowChoiceUi_(wrap);
  }

  function readPresetFromEditor_() {
    const nameEl = el_('live-poll-editor-name');
    const wrap = el_('live-poll-editor-sections');
    const preset = Object.assign({}, editingPreset_, {
      name: (nameEl && nameEl.value) || editingPreset_.name || '',
      sections: []
    });
    wrap.querySelectorAll('.live-poll-editor-section').forEach(function (secEl, si) {
      const nameInput = secEl.querySelector('[data-field="sec-name"]');
      const minId = 'live-poll-sec-min-' + si;
      const secId = 'live-poll-sec-sec-' + si;
      const questions = [];
      secEl.querySelectorAll('.live-poll-q-editor-row').forEach(function (row, qi) {
        const kind = (row.querySelector('[data-field="choiceSet"]') || {}).value || 'ABC';
        const isWritten = kind === 'WRITTEN';
        const answers = isWritten
          ? [(row.querySelector('[data-field="answer"]') || {}).value || '']
          : selectedAnswersFromRow_(row);
        questions.push({
          label: (row.querySelector('[data-field="label"]') || {}).value || ('Q' + (qi + 1) + '.'),
          choiceSet: kind,
          choiceCount: parseInt((row.querySelector('[data-field="choiceCount"]') || {}).value, 10) || 0,
          customChoices: (row.querySelector('[data-field="customChoices"]') || {}).value || '',
          answers: isWritten ? [] : answers,
          answer: isWritten ? (answers[0] || '') : answers.join(',')
        });
      });
      preset.sections.push({
        name: (nameInput && nameInput.value) || ('セクション' + (si + 1)),
        collectDurationSec: readTimerDuration_(minId, secId),
        questions: questions
      });
    });
    return window.LivePollPresetStore.normalizePreset(preset);
  }

  async function openPresetEditor_(id) {
    if (!window.LivePollPresetStore) throw new Error('プリセットストアがありません');
    if (id) {
      editingPreset_ = await LivePollPresetStore.getPreset(id);
      if (!editingPreset_) throw new Error('プリセットが見つかりません');
    } else {
      editingPreset_ = LivePollPresetStore.emptyPreset();
    }
    showEditorView_(true);
    renderPresetEditor_();
  }

  async function ensurePollRoom_() {
    if (!window.LiveRoomModule) throw new Error('授業ライブモジュールが未初期化です');
    const room = LiveRoomModule.getActiveRoom();
    if (room && room.isTeacher) {
      if (room.continueAcrossModes && !isPollRoom_(room)) {
        return LiveRoomModule.switchActivity('poll', { continueAcrossModes: getContinueChecked_() });
      }
      if (isPollRoom_(room)) return room;
    }
    if (room && room.isTeacher && !room.continueAcrossModes) {
      throw new Error('先に開催中の授業ライブを閉じてください');
    }
    const targetClass = window.prompt('名簿に出すクラス（空欄可）', '') || '';
    const title = window.prompt('表示名（空欄＝リアルタイム投票）', '') || '';
    return LiveRoomModule.createPollRoom({
      targetClass: String(targetClass).trim(),
      title: String(title).trim(),
      continueAcrossModes: getContinueChecked_(),
      skipOpenHost: true
    });
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
    [hostEl, stuEl].forEach(function (node) {
      if (!node) return;
      node.textContent = text;
      node.classList.toggle('is-urgent', urgent);
      node.hidden = !text;
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

  function setBtnEnabled_(id, on) {
    const btn = el_(id);
    if (!btn) return;
    btn.disabled = !on;
  }

  function updateHostPanels_(pub) {
    const isPreset = pub.runMode === 'preset';
    const presetPanel = el_('live-poll-host-preset-panel');
    const improvPanel = el_('live-poll-host-improv-panel');
    if (presetPanel) presetPanel.classList.toggle('is-open', isPreset);
    if (improvPanel) improvPanel.classList.toggle('is-hidden', isPreset);
    const nameEl = el_('live-poll-preset-run-name');
    const secEl = el_('live-poll-preset-run-section');
    if (nameEl) nameEl.textContent = isPreset ? ('プリセット: ' + (pub.presetName || '—')) : '';
    if (secEl) {
      secEl.textContent = isPreset
        ? ('セクション ' + ((parseInt(pub.sectionIndex, 10) || 0) + 1) + ' / ' + (pub.sectionCount || '?')
          + (pub.sectionName ? (' — ' + pub.sectionName) : ''))
        : '';
    }
    const contWrap = el_('live-poll-host-continue-wrap');
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom();
    if (contWrap) contWrap.style.display = (room && room.continueAcrossModes) ? '' : 'none';
  }

  function renderHost_(snap) {
    lastHostSnap_ = snap;
    const n = loadPollBestN_();
    const bestInput = el_('live-poll-best-n');
    const bestSelect = el_('live-poll-best-n-select');
    if (bestInput && String(bestInput.value) !== String(n)) bestInput.value = String(n);
    if (bestSelect) bestSelect.value = [3, 4, 8, 16].indexOf(n) >= 0 ? String(n) : '';
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom();
    const pub = pub_(snap);
    updateHostPanels_(pub);
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
    const visibleQs = visibleQuestions_(pub);
    const includeBlank = syncIncludeBlankUi_();
    const joinedN = (snap.entries && snap.entries.length) || snap.joinedCount || 0;
    const showBars = visibleQs.length && (pub.phase === 'collecting' || pub.phase === 'prompt' || pub.phase === 'waiting');
    if (qEl) {
      const qPanel = qEl.closest('.live-poll-panel');
      if (qPanel) qPanel.hidden = !!showBars;
      if (!visibleQs.length) {
        qEl.innerHTML = pub.runMode === 'preset'
          ? '<p class="filter-axis-hint">「このセクションを出す」で設問をまとめて提示します。問題文はスライド側に出してください。</p>'
          : '<p class="filter-axis-hint">記号セットを選んで「この1問を出す」を押してください。問題文はスライド側に出します。</p>';
      } else if (showBars) {
        qEl.innerHTML = '';
      } else if (pub.runMode === 'preset' && pub.phase === 'waiting') {
        qEl.innerHTML = visibleQs.map(function (item) {
          return '<div class="live-poll-q-label">' + escapeHtml_(item.label) + '</div>';
        }).join('');
      } else if (!q) {
        qEl.innerHTML = '';
      } else {
        qEl.innerHTML = '<div class="live-poll-q-label">' + escapeHtml_(q.label) + '</div>'
          + (q.type === 'written'
            ? '<p class="filter-axis-hint">記述欄</p>'
            : '<div class="live-poll-choice-row">' + (q.choices || []).map(function (c) {
              return '<span class="live-poll-chip">' + escapeHtml_(c) + '</span>';
            }).join('') + '</div>');
      }
    }

    const liveTally = (pub.phase === 'collecting' || pub.phase === 'prompt')
      ? tallyFromEntries_(pub, snap.entries)
      : (pub.frozenTally || {});
    if (tallyEl) {
      if (!visibleQs.length || pub.phase === 'idle' || pub.phase === 'sectionWait') {
        tallyEl.innerHTML = '';
      } else if (showBars) {
        tallyEl.innerHTML = visibleQs.map(function (item) {
          return hostQuestionTallyHtml_(item, liveTally[item.id], joinedN, includeBlank, 'bar');
        }).join('');
      } else if (pub.runMode === 'preset' && pub.phase === 'waiting') {
        tallyEl.innerHTML = '<p class="filter-axis-hint">打ち切り済み。問ごとに「集計を表示」へ進んでください。</p>';
      } else if (!q) {
        tallyEl.innerHTML = '';
      } else {
        const t = liveTally[q.id] || { total: 0, choiceCounts: {}, writtenGroups: [] };
        tallyEl.innerHTML = hostQuestionTallyHtml_(q, t, joinedN, includeBlank, 'review');
      }
    }

    if (revealEl) {
      const typingModel = document.activeElement && document.activeElement.id === 'live-poll-model-input';
      if (typingModel) {
        /* keep focus */
      } else if (!q || (pub.phase !== 'results' && pub.phase !== 'reveal')) {
        revealEl.innerHTML = '';
      } else if (q.type === 'written' && pub.runMode === 'preset') {
        revealEl.innerHTML = '<p class="filter-axis-hint">模範解答はプリセットに保存されています（ホストには非表示）</p>'
          + '<button type="button" class="btn-primary" id="live-poll-reveal-written-btn">模範解答を出す</button>';
        const btn = el_('live-poll-reveal-written-btn');
        if (btn) {
          btn.onclick = function () {
            BusyButton.run(btn, function () {
              return control_('reveal', { questionId: q.id });
            }, '提示中…').catch(function (e) { alert(e.message || e); });
          };
        }
      } else if (q.type === 'written') {
        const current = formatAnswerList_(pub.revealed && pub.revealed[q.id]) || '';
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
        const revealedList = parseAnswerList_(pub.revealed && pub.revealed[q.id]);
        let html = '<p class="filter-axis-hint">正答の記号をタップ（複数可。もう一度タップで解除）</p>';
        if (pub.runMode === 'preset') {
          html += '<button type="button" class="btn-primary" id="live-poll-reveal-preset-choice-btn" style="margin-bottom:8px;">プリセットの正答を出す</button>';
        }
        html += '<div class="live-poll-choice-grid">' + (q.choices || []).map(function (c) {
          const cls = revealedList.indexOf(c) >= 0 ? ' live-poll-choice-btn is-revealed' : ' live-poll-choice-btn';
          return '<button type="button" class="btn-secondary' + cls + '" data-poll-answer="'
            + escapeHtml_(c) + '">' + escapeHtml_(c) + '</button>';
        }).join('') + '</div>';
        revealEl.innerHTML = html;
        const presetBtn = el_('live-poll-reveal-preset-choice-btn');
        if (presetBtn) {
          presetBtn.onclick = function () {
            BusyButton.run(presetBtn, function () {
              return control_('reveal', { questionId: q.id, fromPreset: true });
            }, '提示中…').catch(function (e) { alert(e.message || e); });
          };
        }
        revealEl.querySelectorAll('[data-poll-answer]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            const val = btn.getAttribute('data-poll-answer');
            const next = revealedList.slice();
            const i = next.indexOf(val);
            if (i >= 0) next.splice(i, 1);
            else next.push(val);
            BusyButton.run(btn, function () {
              return control_('reveal', { questionId: q.id, answers: next });
            }, '提示中…').catch(function (e) { alert(e.message || e); });
          });
        });
      }
    }

    const collecting = pub.phase === 'collecting';
    const hasQ = !!(pub.questions && pub.questions.length);
    const isPreset = pub.runMode === 'preset';

    setBtnEnabled_('live-poll-start-improv-btn', !isPreset && pub.phase !== 'collecting');
    setBtnEnabled_('live-poll-start-collect-btn', !isPreset && hasQ && pub.phase !== 'collecting');
    setBtnEnabled_('live-poll-end-collect-btn', !isPreset && collecting);
    setBtnEnabled_('live-poll-show-results-btn', !isPreset && hasQ && pub.phase !== 'idle' && pub.phase !== 'prompt');
    setBtnEnabled_('live-poll-undo-reveal-btn', !isPreset && pub.phase === 'reveal');
    setBtnEnabled_('live-poll-reset-btn', !isPreset && pub.phase !== 'collecting');

    setBtnEnabled_('live-poll-start-section-btn', isPreset && (pub.phase === 'idle' || pub.phase === 'sectionWait'));
    setBtnEnabled_('live-poll-preset-end-collect-btn', isPreset && collecting);
    setBtnEnabled_('live-poll-preset-show-results-btn', isPreset && hasQ && (pub.phase === 'waiting' || pub.phase === 'results' || pub.phase === 'reveal'));
    setBtnEnabled_('live-poll-preset-next-review-btn', isPreset && pub.phase === 'reveal');
    setBtnEnabled_('live-poll-preset-next-section-btn', isPreset && pub.phase === 'sectionWait'
      && (parseInt(pub.sectionIndex, 10) || 0) + 1 < (parseInt(pub.sectionCount, 10) || 0));
    setBtnEnabled_('live-poll-preset-undo-reveal-btn', isPreset && pub.phase === 'reveal');

    if (collecting && pub.collectEndsAt) startCollectTimer_(pub.collectEndsAt, true);
    else if (collecting) paintTimer_(0);
    else {
      stopCollectTimer_();
      paintTimer_(0);
    }
    renderHostRoster_(snap, pub);
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
    const locked = pub.phase === 'waiting' || pub.phase === 'results' || pub.phase === 'reveal' || pub.phase === 'sectionWait';
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

    if (pub.phase === 'sectionWait') {
      body.innerHTML = '<p class="live-poll-wait-msg">このセクションの答え合わせが終わりました。次のセクションを待っています。</p>';
      return;
    }

    if (!qs.length || pub.phase === 'idle') {
      body.innerHTML = '<p class="live-poll-wait-msg">まもなく出題されます。問題はスライドを見てください。</p>';
      return;
    }

    if (pub.phase === 'prompt') {
      body.innerHTML = '<p class="live-poll-wait-msg">設問が出ています。集約開始を待ってください。</p>'
        + qs.map(function (item) { return questionBlockHtml_(item, false, false); }).join('');
      return;
    }

    if (collecting) {
      body.innerHTML = qs.map(function (item) { return questionBlockHtml_(item, true, false); }).join('');
      bindStudentInputs_(qs);
      return;
    }

    if (locked && !showResults) {
      body.innerHTML = '<p class="live-poll-wait-msg">回答を受け付けました。変更できません。</p>'
        + qs.map(function (item) { return questionBlockHtml_(item, false, true); }).join('');
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

    body.innerHTML = qs.map(function (item) { return questionBlockHtml_(item, false, true); }).join('');
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

  async function openSetup() {
    if (!window.LiveRoomModule || !LiveRoomModule.isAdminUser_()) {
      throw new Error('管理者のみ投票を開催できます');
    }
    setHostOpen_(false);
    setStudentOpen_(false);
    setSetupOpen_(true);
    paintSetupRoomInfo_();
    await renderPresetList_();
  }

  function persistContinueToRoom_() {
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom && LiveRoomModule.getActiveRoom();
    if (!room || !room.isTeacher) return;
    room.continueAcrossModes = getContinueChecked_();
    if (LiveRoomModule.touchActiveRoom) LiveRoomModule.touchActiveRoom(room);
  }

  function closeSetup() {
    persistContinueToRoom_();
    setSetupOpen_(false);
    showEditorView_(false);
    editingPreset_ = null;
  }

  async function openHost() {
    if (!window.LiveRoomModule || !LiveRoomModule.isAdminUser_()) {
      throw new Error('管理者のみ投票を開催できます');
    }
    const room = LiveRoomModule.getActiveRoom();
    if (!isPollRoom_(room) || !room.isTeacher) {
      throw new Error('投票ライブの部屋がありません');
    }
    closeSetup();
    setStudentOpen_(false);
    setHostOpen_(true);
    initImprovChoiceUi_();
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

  async function runImprov_() {
    await ensurePollRoom_();
    await openHost();
  }

  async function runPreset_() {
    if (!selectedPresetId_ || !window.LivePollPresetStore) throw new Error('プリセットを選んでください');
    const preset = await LivePollPresetStore.getPreset(selectedPresetId_);
    if (!preset) throw new Error('プリセットが見つかりません');
    await ensurePollRoom_();
    await control_('loadPreset', { preset: preset });
    await openHost();
  }

  async function openStudent() {
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom();
    if (!isPollRoom_(room) || room.isTeacher) {
      throw new Error('投票ライブに参加してから開いてください');
    }
    setHostOpen_(false);
    closeSetup();
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
    closeSetup();
    unsubscribe_();
    lastHostSnap_ = null;
  }

  function bindHostButtons_() {
    bindClick_('live-poll-start-improv-btn', function () {
      const v = validateImprovChoice_();
      if (!v.ok) throw new Error(v.error || '選択肢が不正です');
      const cfg = v.config || readImprovChoiceConfig_();
      return control_('startImprov', {
        choiceSet: cfg.kind || cfg.choiceSet,
        choiceCount: cfg.count != null ? cfg.count : cfg.choiceCount,
        customChoices: cfg.customChoices || ''
      });
    }, '出題中…');
    bindClick_('live-poll-start-collect-btn', function () {
      return control_('startCollect', { durationSec: collectDurationFromUi_() });
    }, '開始中…');
    bindClick_('live-poll-end-collect-btn', function () { return control_('endCollect'); }, '打ち切り中…');
    bindClick_('live-poll-show-results-btn', function () { return control_('showResults'); }, '表示中…');
    bindClick_('live-poll-undo-reveal-btn', function () { return control_('undoReveal'); }, '取消中…');
    bindClick_('live-poll-reset-btn', function () { return control_('resetQuestion'); }, '切替中…');
    bindClick_('live-poll-start-section-btn', function () { return control_('startSection'); }, '出題中…');
    bindClick_('live-poll-preset-end-collect-btn', function () { return control_('endCollect'); }, '打ち切り中…');
    bindClick_('live-poll-preset-show-results-btn', function () { return control_('showResults'); }, '表示中…');
    bindClick_('live-poll-preset-next-review-btn', function () { return control_('nextReview'); }, '進行中…');
    bindClick_('live-poll-preset-next-section-btn', function () { return control_('nextSection'); }, '開始中…');
    bindClick_('live-poll-preset-undo-reveal-btn', function () { return control_('undoReveal'); }, '取消中…');

    const back = el_('live-poll-host-back-btn');
    if (back) {
      back.addEventListener('click', function () {
        setHostOpen_(false);
        unsubscribe_();
        openSetup().catch(function (e) { alert(e.message || e); });
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
    const fontMinus = el_('live-poll-font-minus');
    const fontPlus = el_('live-poll-font-plus');
    const fontInput = el_('live-poll-font-input');
    applyFontPt_(loadFontPt_(), false);
    if (fontMinus) {
      fontMinus.addEventListener('click', function () {
        applyFontPt_(loadFontPt_() - 1, true);
      });
    }
    if (fontPlus) {
      fontPlus.addEventListener('click', function () {
        applyFontPt_(loadFontPt_() + 1, true);
      });
    }
    if (fontInput) {
      fontInput.addEventListener('change', function () {
        applyFontPt_(fontInput.value, true);
      });
      fontInput.addEventListener('input', function () {
        const n = parseInt(fontInput.value, 10);
        if (!isNaN(n)) applyFontPt_(n, true);
      });
    }
    const bestSelect = el_('live-poll-best-n-select');
    const bestInput = el_('live-poll-best-n');
    function applyPollBestN_(value) {
      if (window.LiveRoomModule && typeof LiveRoomModule.setBestN === 'function') {
        LiveRoomModule.setBestN(value);
        return;
      }
      if (lastHostSnap_) renderHost_(lastHostSnap_);
    }
    if (bestSelect) {
      bestSelect.addEventListener('change', function () {
        if (!bestSelect.value) return;
        applyPollBestN_(bestSelect.value);
      });
    }
    if (bestInput) {
      bestInput.addEventListener('change', function () {
        applyPollBestN_(bestInput.value);
      });
      bestInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') applyPollBestN_(bestInput.value);
      });
    }
    const blankCb = el_('live-poll-include-blank');
    if (blankCb && !blankCb.dataset.bound) {
      blankCb.dataset.bound = '1';
      syncIncludeBlankUi_();
      blankCb.addEventListener('change', function () {
        saveIncludeBlank_(blankCb.checked);
        if (lastHostSnap_) renderHost_(lastHostSnap_);
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

  function bindClick_(id, fn, busyLabel) {
    const btn = el_(id);
    if (!btn) return;
    btn.addEventListener('click', function () {
      BusyButton.run(btn, fn, busyLabel || '処理中…').catch(function (e) { alert(e.message || e); });
    });
  }

  function bindSetupButtons_() {
    bindClick_('live-poll-setup-back-btn', function () {
      closeSetup();
      if (window.LiveRoomModule && LiveRoomModule.refreshUi_) LiveRoomModule.refreshUi_();
    });
    bindClick_('live-poll-run-improv-btn', runImprov_, '開いています…');
    bindClick_('live-poll-run-preset-btn', runPreset_, '読み込み中…');
    bindClick_('live-poll-preset-new-btn', function () { return openPresetEditor_(null); });
    const importBtn = el_('live-poll-preset-import-btn');
    const importFile = el_('live-poll-preset-import-file');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () { importFile.click(); });
      importFile.addEventListener('change', function () {
        const file = importFile.files && importFile.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function () {
          try {
            editingPreset_ = LivePollPresetStore.importJson(String(reader.result || ''));
            showEditorView_(true);
            renderPresetEditor_();
          } catch (e) {
            alert(e.message || e);
          }
          importFile.value = '';
        };
        reader.readAsText(file, 'utf-8');
      });
    }
    bindClick_('live-poll-editor-back-btn', function () {
      showEditorView_(false);
      editingPreset_ = null;
      return renderPresetList_();
    });
    bindClick_('live-poll-editor-save-btn', async function () {
      persistEditorToModel_();
      const preset = readPresetFromEditor_();
      await LivePollPresetStore.savePreset(preset);
      selectedPresetId_ = preset.id;
      showEditorView_(false);
      editingPreset_ = null;
      await renderPresetList_();
    }, '保存中…');
    bindClick_('live-poll-editor-export-btn', function () {
      persistEditorToModel_();
      const preset = readPresetFromEditor_();
      const blob = new Blob([LivePollPresetStore.exportJson(preset)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (preset.name || 'poll-preset') + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    bindClick_('live-poll-editor-delete-btn', async function () {
      if (!editingPreset_ || !editingPreset_.id) return;
      if (!window.confirm('このプリセットを削除しますか？')) return;
      await LivePollPresetStore.deletePreset(editingPreset_.id);
      showEditorView_(false);
      editingPreset_ = null;
      selectedPresetId_ = '';
      await renderPresetList_();
    }, '削除中…');
    const addSec = el_('live-poll-editor-add-section-btn');
    if (addSec) {
      addSec.addEventListener('click', function () {
        persistEditorToModel_();
        if (!editingPreset_) editingPreset_ = LivePollPresetStore.emptyPreset();
        editingPreset_.sections.push({
          name: 'セクション' + (editingPreset_.sections.length + 1),
          collectDurationSec: 120,
          questions: [{ label: 'Q1.', choiceSet: 'ABC', choiceCount: 3, customChoices: '', answers: [], answer: '' }]
        });
        renderPresetEditor_();
      });
    }
  }

  function init() {
    initImprovChoiceUi_();
    bindHostButtons_();
    bindSetupButtons_();
  }

  return {
    init: init,
    openSetup: openSetup,
    closeSetup: closeSetup,
    openHost: openHost,
    openStudent: openStudent,
    closeScreens: closeScreens,
    isPollRoom: isPollRoom_,
    isHostOpen: function () { return hostOpen_; },
    isStudentOpen: function () { return studentOpen_; },
    isSetupOpen: function () { return setupOpen_; },
    refreshHost: function () {
      if (hostOpen_ && lastHostSnap_) renderHost_(lastHostSnap_);
    }
  };
})();

window.LivePollModule = LivePollModule;
