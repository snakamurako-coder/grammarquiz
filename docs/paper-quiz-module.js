/**
 * A4 問題用紙（記入欄つき）と別紙の採点用模範解
 */
const PaperQuizModule = (function () {
  const CHOICE_MARKS = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ', 'キ', 'ク', 'ケ', 'コ'];

  function escapeHtml_(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function joinEn_(prefix, inner, suffix) {
    if (typeof window.joinEnglish === 'function') return window.joinEnglish(prefix, inner, suffix);
    let s = prefix ? (inner ? prefix + ' ' + inner : prefix) : (inner || '');
    if (suffix) s += /^[.,!?;:]/.test(suffix) ? suffix : (' ' + suffix);
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function isUnknownChoice_(c) {
    if (!c) return false;
    if (c.isUnknown) return true;
    const t = String(c.text || c || '');
    return t.indexOf('わからない') >= 0;
  }

  function paperChoices_(q) {
    return (q.choices || []).filter(function (c) { return !isUnknownChoice_(c); });
  }

  function formatLabel_(q) {
    if (q.vocabFormatLabel) return q.vocabFormatLabel;
    const map = window.GRAMMAR_FORMAT_MAP || {};
    const meta = map[q.format];
    if (meta && meta.label) return meta.label;
    return q.format || '';
  }

  function isGrammarQ_(q) {
    const f = String(q.format || '');
    return /^[A-H]$/.test(f) || !!(q.grammarArea || q.rowId);
  }

  function explanationOf_(q) {
    if (!isGrammarQ_(q)) return '';
    const fn = window.normalizeExplanationField_;
    const raw = fn ? fn(q.explanation) : String(q.explanation || '').trim();
    return raw;
  }

  function correctTextOf_(q) {
    if (q.format === 'H') {
      const presented = String(q.presentedSentence || '');
      const correct = String(q.correctSentence || '');
      const norm = window.normalizeEnglish
        ? window.normalizeEnglish
        : function (s) { return String(s || '').toLowerCase().trim(); };
      const ok = norm(presented) === norm(correct);
      return ok ? '正しい' : '誤っている　正: ' + correct;
    }
    if (q.correctAnswer) return String(q.correctAnswer);
    if (q.correctText) return String(q.correctText);
    if (q.expectedInner) return String(q.expectedInner);
    if (q.expectedAnswer) return String(q.expectedAnswer);
    if (q.fullSentenceDisplay) return String(q.fullSentenceDisplay);
    const hit = paperChoices_(q).filter(function (c) { return c.isCorrect; })[0];
    if (hit) return String(hit.text || '');
    return '';
  }

  function completedSentence_(q) {
    if (q.answerPrefix != null || q.answerSuffix != null) {
      const inner = q.expectedInner || q.mcqAnswer || q.correctText || '';
      if (q.answerPrefix || q.answerSuffix || inner) {
        return joinEn_(q.answerPrefix || q.mcqPrefix || '', inner, q.answerSuffix || q.mcqSuffix || '');
      }
    }
    return '';
  }

  function clozeHtml_(prefix, suffix, filled) {
    const p = escapeHtml_(prefix || '');
    const s = escapeHtml_(suffix || '');
    const mid = filled
      ? '<span class="pq-fill">' + escapeHtml_(filled) + '</span>'
      : '<span class="pq-blank">____________________</span>';
    return '<div class="pq-cloze">' + p + (p ? ' ' : '') + mid + (s && !/^[.,!?;:]/.test(s) ? ' ' : '') + s + '</div>';
  }

  function linesHtml_(n) {
    n = n || 2;
    let html = '<div class="pq-lines">';
    for (let i = 0; i < n; i++) html += '<div class="pq-line"></div>';
    html += '</div>';
    return html;
  }

  function choiceListHtml_(choices, mode) {
    let html = '<ol class="pq-choices">';
    choices.forEach(function (c, i) {
      const mark = CHOICE_MARKS[i] || String(i + 1);
      const text = escapeHtml_(c.text || '');
      const on = mode === 'key' && c.isCorrect;
      html += '<li class="' + (on ? 'pq-choice-correct' : '') + '">';
      html += '<span class="pq-mark">' + (on ? '●' : '○') + mark + '</span> ' + text;
      html += '</li>';
    });
    html += '</ol>';
    return html;
  }

  function tokensHtml_(tokens) {
    if (!tokens || !tokens.length) return '';
    return '<div class="pq-tokens">【語句】 ' + tokens.map(function (t) {
      return '<span class="pq-token">' + escapeHtml_(t) + '</span>';
    }).join(' ') + '</div>';
  }

  function stemHtml_(q) {
    let html = '';
    const ja = q.japanese || q.promptJa || '';
    if (ja) html += '<div class="pq-ja">' + escapeHtml_(ja) + '</div>';
    if (q.posLabel) html += '<div class="pq-meta">' + escapeHtml_(q.posLabel) + '</div>';
    const en = q.presentedSentence || q.promptEn || q.word || '';
    const showEn = q.format === 'H' || !!q.promptEn || !!q.presentedSentence
      || (q.word && !ja)
      || (q.word && String(q.format || '').indexOf('enja') >= 0);
    if (en && showEn) html += '<div class="pq-en">' + escapeHtml_(en) + '</div>';
    return html;
  }

  function responseHtml_(q, mode) {
    const isKey = mode === 'key';
    const correct = correctTextOf_(q);
    const f = String(q.format || '');
    const choices = paperChoices_(q);
    const prefix = q.answerPrefix || q.mcqPrefix || '';
    const suffix = q.answerSuffix || q.mcqSuffix || '';

    if (f === 'H') {
      if (isKey) {
        return '<div class="pq-tf"><span class="pq-fill">' + escapeHtml_(correct) + '</span></div>';
      }
      return '<div class="pq-tf">□ 正しい　　□ 誤っている</div>';
    }

    if (choices.length && q.sharedPool) {
      if (prefix || suffix) {
        return clozeHtml_(prefix, suffix, isKey ? (q.expectedInner || q.mcqAnswer || correct) : '')
          + (isKey ? '<div class="pq-key-line">正答: <span class="pq-fill">' + escapeHtml_(correct) + '</span></div>' : '');
      }
      if (isKey) {
        return '<div class="pq-key-line">正答: <span class="pq-fill">' + escapeHtml_(correct) + '</span></div>';
      }
      return linesHtml_(1);
    }

    if (choices.length) {
      return choiceListHtml_(choices, mode);
    }

    if (f === 'E' || f === 'C' || f === 'D') {
      let html = tokensHtml_(q.poolTokens);
      html += clozeHtml_(prefix, suffix, isKey ? (q.expectedInner || '') : '');
      if (isKey) {
        const full = completedSentence_(q);
        if (full) html += '<div class="pq-key-line">完成文: <span class="pq-fill">' + escapeHtml_(full) + '</span></div>';
      } else {
        html += linesHtml_(1);
      }
      return html;
    }

    if (prefix || suffix || f === 'B' || f === 'F' || f === 'W2' || f === 'W3' || f === 'W5' || f === 'W6') {
      const inner = isKey ? (q.expectedInner || q.mcqAnswer || correct) : '';
      let html = clozeHtml_(prefix, suffix, inner);
      if (isKey) {
        const full = completedSentence_(q);
        if (full && full !== inner) html += '<div class="pq-key-line">完成文: <span class="pq-fill">' + escapeHtml_(full) + '</span></div>';
      } else {
        html += linesHtml_(f === 'A' ? 0 : 1);
      }
      return html;
    }

    if (isKey) {
      return '<div class="pq-key-line"><span class="pq-fill">' + escapeHtml_(correct) + '</span></div>';
    }
    return linesHtml_(f === 'A' || f === 'W1' || f === 'W4' ? 3 : 2);
  }

  function itemHtml_(item, mode) {
    const q = item.q;
    const label = formatLabel_(q);
    let html = '<article class="pq-item">';
    html += '<div class="pq-item-head"><span class="pq-no">' + item.no + '</span>';
    if (label) html += '<span class="pq-fmt">' + escapeHtml_(label) + '</span>';
    if (item.points != null) html += '<span class="pq-pts">' + escapeHtml_(String(item.points)) + '点</span>';
    html += '</div>';
    html += stemHtml_(q);
    html += responseHtml_(q, mode);
    if (mode === 'key' && isGrammarQ_(q)) {
      const exp = explanationOf_(q);
      const area = String(q.grammarArea || '').trim();
      if (area || exp) {
        html += '<div class="pq-exp">';
        if (area) html += '<div class="pq-exp-area">' + escapeHtml_(area) + '</div>';
        if (exp) html += '<div class="pq-exp-body">' + escapeHtml_(exp) + '</div>';
        html += '</div>';
      }
    }
    html += '</article>';
    return html;
  }

  function headerHtml_(meta, sheetKind) {
    const title = sheetKind === 'key' ? '採点用　模範解' : '問題用紙';
    const sub = sheetKind === 'key' ? '（別紙・学習者用ではありません）' : '';
    let html = '<header class="pq-header">';
    html += '<div class="pq-title-block">';
    html += '<div class="pq-kicker">' + escapeHtml_(title) + sub + '</div>';
    html += '<h1>' + escapeHtml_(meta.title || '小テスト') + '</h1>';
    if (meta.subtitle) html += '<p class="pq-sub">' + escapeHtml_(meta.subtitle) + '</p>';
    if (meta.pointsMax) html += '<p class="pq-sub">満点 ' + escapeHtml_(String(meta.pointsMax)) + ' 点　／　' + escapeHtml_(String(meta.count)) + ' 問</p>';
    else html += '<p class="pq-sub">' + escapeHtml_(String(meta.count)) + ' 問</p>';
    html += '</div>';
    html += '<table class="pq-idbox"><tbody>';
    html += '<tr><th>学年</th><td></td><th>組</th><td></td></tr>';
    html += '<tr><th>番号</th><td></td><th>氏名</th><td class="pq-name"></td></tr>';
    html += '<tr><th>点数</th><td class="pq-score" colspan="3"></td></tr>';
    html += '</tbody></table>';
    html += '</header>';
    return html;
  }

  function poolBannerHtml_(items, mode) {
    const seen = {};
    const banks = [];
    items.forEach(function (it) {
      const pool = it.q.sharedPool;
      if (!pool || !pool.length) return;
      const key = pool.join('\u0001');
      if (seen[key]) return;
      seen[key] = true;
      banks.push(pool);
    });
    if (!banks.length) return '';
    let html = '';
    banks.forEach(function (pool, i) {
      html += '<div class="pq-bank"><strong>語群' + (banks.length > 1 ? (i + 1) : '') + '</strong>　';
      html += pool.map(function (t) { return escapeHtml_(t); }).join('　／　');
      html += '</div>';
    });
    if (mode === 'question') {
      html += '<p class="pq-bank-note">語群の語句を使って答えなさい（同じ語を二度使わない）。</p>';
    }
    return html;
  }

  function sheetHtml_(items, meta, mode) {
    let html = '<section class="pq-sheet pq-sheet-' + mode + '">';
    html += headerHtml_(meta, mode);
    html += poolBannerHtml_(items, mode);
    items.forEach(function (it) { html += itemHtml_(it, mode); });
    html += '</section>';
    return html;
  }

  function cssText_() {
    return [
      '* { box-sizing: border-box; }',
      'html, body { margin: 0; padding: 0; background: #e8e8e8; color: #111; font-family: "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif; }',
      '.pq-toolbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; background: #1e293b; color: #fff; }',
      '.pq-toolbar button { min-height: 40px; padding: 8px 14px; border-radius: 8px; border: 0; cursor: pointer; font-weight: 700; }',
      '.pq-toolbar .is-on { background: #38bdf8; color: #0f172a; }',
      '.pq-toolbar button:not(.is-on) { background: #334155; color: #fff; }',
      '.pq-print { background: #22c55e !important; color: #052e16 !important; }',
      '.pq-page { width: 210mm; min-height: 297mm; margin: 16px auto; padding: 14mm 14mm 16mm; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.12); }',
      '.pq-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }',
      '.pq-title-block { flex: 1; min-width: 0; }',
      '.pq-kicker { font-size: 12px; font-weight: 800; letter-spacing: .08em; }',
      'h1 { font-size: 18px; margin: 4px 0 6px; }',
      '.pq-sub { margin: 0; font-size: 11px; color: #333; }',
      '.pq-idbox { border-collapse: collapse; font-size: 12px; flex-shrink: 0; }',
      '.pq-idbox th, .pq-idbox td { border: 1px solid #111; padding: 4px 8px; }',
      '.pq-idbox th { background: #f3f3f3; width: 2.6em; text-align: center; }',
      '.pq-idbox td { min-width: 3.2em; height: 22px; }',
      '.pq-idbox td.pq-name { min-width: 8em; }',
      '.pq-idbox td.pq-score { min-width: 4em; }',
      '.pq-bank { font-size: 12px; border: 1px solid #333; padding: 8px; margin-bottom: 8px; line-height: 1.6; }',
      '.pq-bank-note { font-size: 11px; margin: 0 0 10px; }',
      '.pq-item { break-inside: avoid; page-break-inside: avoid; border-bottom: 1px dotted #999; padding: 8px 0 10px; }',
      '.pq-item-head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; }',
      '.pq-no { font-weight: 800; font-size: 14px; }',
      '.pq-fmt, .pq-pts { font-size: 11px; color: #444; }',
      '.pq-ja { font-size: 13px; font-weight: 700; margin: 2px 0; }',
      '.pq-en { font-size: 13px; margin: 2px 0; }',
      '.pq-meta { font-size: 11px; color: #555; }',
      '.pq-cloze { font-size: 13px; margin: 6px 0; line-height: 1.7; }',
      '.pq-blank { display: inline-block; min-width: 8em; border-bottom: 1px solid #111; }',
      '.pq-fill { font-weight: 800; text-decoration: underline; color: #9a0000; }',
      '.pq-lines { margin: 6px 0 0; }',
      '.pq-line { border-bottom: 1px solid #333; height: 22px; }',
      '.pq-choices { list-style: none; padding: 0; margin: 6px 0 0; font-size: 13px; }',
      '.pq-choices li { margin: 3px 0; }',
      '.pq-mark { font-family: monospace; margin-right: 4px; }',
      '.pq-choice-correct { font-weight: 800; }',
      '.pq-tokens { font-size: 12px; margin: 6px 0; }',
      '.pq-token { display: inline-block; border: 1px solid #333; padding: 1px 6px; margin: 2px; }',
      '.pq-tf { margin: 8px 0; font-size: 13px; }',
      '.pq-key-line { margin-top: 4px; font-size: 13px; }',
      '.pq-exp { margin-top: 6px; background: #fff8e1; border-left: 3px solid #f9a825; padding: 6px 8px; font-size: 11px; line-height: 1.5; }',
      '.pq-exp-area { font-weight: 800; margin-bottom: 2px; }',
      '.pq-sheet-key { page-break-before: always; }',
      '@page { size: A4; margin: 12mm; }',
      '@media print {',
      '  body { background: #fff; }',
      '  .pq-toolbar { display: none !important; }',
      '  .pq-page { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }',
      '  body.print-q .pq-sheet-key { display: none !important; }',
      '  body.print-k .pq-sheet-question { display: none !important; }',
      '  body.print-k .pq-sheet-key { page-break-before: auto; }',
      '}'
    ].join('\n');
  }

  function toItems_(questions) {
    return (questions || []).map(function (q, i) {
      return {
        no: i + 1,
        q: q,
        points: q._pointsPerQuestion
      };
    });
  }

  function openPreview_(questions, meta) {
    const items = toItems_(questions);
    if (!items.length) throw new Error('印刷できる問題がありません。');
    meta = Object.assign({ count: items.length }, meta || {});
    const qHtml = sheetHtml_(items, meta, 'question');
    const kHtml = sheetHtml_(items, meta, 'key');
    const html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>'
      + escapeHtml_(meta.title || '小テスト')
      + '</title><style>' + cssText_() + '</style></head><body class="print-both">'
      + '<div class="pq-toolbar">'
      + '<button type="button" data-view="both" class="is-on">問題＋模範解</button>'
      + '<button type="button" data-view="q">問題用紙のみ</button>'
      + '<button type="button" data-view="k">採点用模範解のみ</button>'
      + '<button type="button" class="pq-print" id="pq-do-print">印刷 / PDF</button>'
      + '<span style="font-size:12px;opacity:.85;">問題用紙と採点用模範解は別ページです</span>'
      + '</div>'
      + '<div class="pq-page">' + qHtml + kHtml + '</div>'
      + '<script>(function(){'
      + 'var b=document.body;document.querySelectorAll("[data-view]").forEach(function(btn){'
      + 'btn.addEventListener("click",function(){b.className="print-"+btn.getAttribute("data-view");'
      + 'document.querySelectorAll("[data-view]").forEach(function(x){x.classList.toggle("is-on",x===btn);});});});'
      + 'document.getElementById("pq-do-print").onclick=function(){window.print();};'
      + '})();<\/script></body></html>';

    const w = window.open('', 'paper-quiz');
    if (!w) {
      throw new Error('印刷ウィンドウを開けませんでした。ポップアップを許可してください。');
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    try { w.focus(); } catch (e) { /* ignore */ }
  }

  async function buildGrammarQuestions_() {
    if (!window.GrammarSettingsModule || !window.GrammarQuizGenerator || !window.AlgorithmModule) {
      throw new Error('文法モジュールが読み込まれていません');
    }
    if (GrammarSettingsModule.getSelectedUnits().length === 0) {
      throw new Error('教材を1つ以上選択してください。');
    }
    const options = GrammarSettingsModule.getQuizOptions();
    if (!options.formats || !options.formats.length) {
      throw new Error('出題形式を1つ以上選択してください。');
    }
    await GrammarSettingsModule.prepareForStart();
    const rows = GrammarSettingsModule.getFilteredRows();
    const modeEl = document.querySelector('input[name="play-mode"]:checked');
    const mode = modeEl ? modeEl.value : 'normal';
    const questionCount = GrammarSettingsModule.getQuestionCount();
    const generated = GrammarQuizGenerator.buildQuestions(rows, options);
    if (!generated.length) throw new Error('選択した出題形式で生成できる問題がありません。');
    const questions = AlgorithmModule.buildQuestionSet(generated, mode, questionCount);
    if (!questions.length) throw new Error('選択した条件で出題できる問題がありません。');
    const units = GrammarSettingsModule.getSelectedUnits() || [];
    const subject = (typeof window.getSelectedSubjectName === 'function')
      ? window.getSelectedSubjectName()
      : '';
    return {
      questions: questions,
      meta: {
        title: (subject || '文法・語法演習') + (units.length ? ' / ' + units.join(', ') : ''),
        subtitle: '文法・語法演習　形式: ' + options.formats.join(', '),
        count: questions.length
      }
    };
  }

  async function buildVocabQuestions_() {
    if (!window.VocabSettingsModule) throw new Error('単語設定モジュールが読み込まれていません');
    const options = VocabSettingsModule.getQuizOptions();
    if (!options.bookName || !options.sheetName) throw new Error('ブックと教材（シート）を選択してください。');
    if (!options.formats || !options.formats.length) throw new Error('①和英/英和 と ②語/句/例文 を1つ以上選んでください。');
    const bookType = (document.getElementById('vocab-book-type') || {}).value;
    let result;
    if (bookType === 'user' && window.AuthGateService && AuthGateService.isValid()) {
      if (!window.UserVocabCacheModule) throw new Error('ユーザー単語キャッシュが未初期化です');
      result = UserVocabCacheModule.getWordsForStart(options.sheetName, options.filters);
    } else {
      result = await PresetModule.getVocabWords(options.bookName, options.sheetName, JSON.stringify(options.filters), true, false);
    }
    if (!result || result.status !== 'success') throw new Error((result && result.message) || '単語取得失敗');
    const words = result.data.words || [];
    const pool = result.data.pool || [];
    const bookPool = result.data.bookPool || pool;
    if (!words.length) throw new Error('条件に合う単語がありません。');
    const questions = typeof window.prepareVocabQuestions === 'function'
      ? prepareVocabQuestions(words, pool, bookPool, options, null)
      : VocabQuizGenerator.buildQuestions(words, pool, bookPool, options);
    if (!questions.length) throw new Error('出題できる問題がありません。');
    return {
      questions: questions,
      meta: {
        title: options.bookName + ' / ' + options.sheetName,
        subtitle: '単語クイズ',
        count: questions.length
      }
    };
  }

  async function openFromGrammar() {
    const pack = await buildGrammarQuestions_();
    openPreview_(pack.questions, pack.meta);
  }

  async function openFromVocab() {
    const pack = await buildVocabQuestions_();
    openPreview_(pack.questions, pack.meta);
  }

  async function openFromAssignment(row) {
    if (!window.AssignmentModule || typeof AssignmentModule.buildQuestionsForAssignment !== 'function') {
      throw new Error('課題モジュールが印刷に対応していません');
    }
    const a = row && row.assignment;
    if (!a) throw new Error('課題データがありません');
    const built = await AssignmentModule.buildQuestionsForAssignment(a, {});
    const questions = (built && built.questions) || [];
    if (!questions.length) throw new Error('この課題から問題を作れませんでした。');
    const kind = a.Kind === 'quiz' ? '小テスト' : '宿題';
    openPreview_(questions, {
      title: a.Title || kind,
      subtitle: kind,
      count: questions.length,
      pointsMax: built.pointsMax || ''
    });
  }

  function bindUiOnce_() {
    const gBtn = document.getElementById('grammar-paper-print-btn');
    if (gBtn && !gBtn._pqBound) {
      gBtn._pqBound = true;
      gBtn.addEventListener('click', function () {
        const run = window.BusyButton && BusyButton.run
          ? BusyButton.run(gBtn, openFromGrammar, '用紙作成中…')
          : openFromGrammar();
        Promise.resolve(run).catch(function (e) {
          alert(e.message || e);
        });
      });
    }
    const vBtn = document.getElementById('vocab-paper-print-btn');
    if (vBtn && !vBtn._pqBound) {
      vBtn._pqBound = true;
      vBtn.addEventListener('click', function () {
        const run = window.BusyButton && BusyButton.run
          ? BusyButton.run(vBtn, openFromVocab, '用紙作成中…')
          : openFromVocab();
        Promise.resolve(run).catch(function (e) {
          alert(e.message || e);
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUiOnce_);
  } else {
    bindUiOnce_();
  }

  return {
    openFromGrammar: openFromGrammar,
    openFromVocab: openFromVocab,
    openFromAssignment: openFromAssignment,
    bindUi: bindUiOnce_
  };
})();
window.PaperQuizModule = PaperQuizModule;
