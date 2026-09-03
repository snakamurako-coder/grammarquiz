/**
 * A4 問題用紙（記入欄つき）と別紙の採点用模範解
 * 2列レイアウト。1列の問数・文字サイズ・行の高さはプレビューで調整可能。
 */
const PaperQuizModule = (function () {
  const CHOICE_MARKS = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ', 'キ', 'ク', 'ケ', 'コ'];
  const PER_COL_KEY = 'dd_paper_quiz_per_col';
  const PER_COL_MIN = 10;
  const PER_COL_MAX = 20;
  const PER_COL_DEFAULT = 15;
  const FONT_KEY = 'dd_paper_quiz_font';
  const LH_KEY = 'dd_paper_quiz_lh';
  const FONT_SIZES = [8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 13, 14];
  const FONT_DEFAULT = 9.5;
  const LINE_HEIGHTS = [1.15, 1.2, 1.28, 1.35, 1.45, 1.55, 1.7];
  const LH_DEFAULT = 1.28;
  let lastPreview_ = null;

  function clampPerCol_(n) {
    n = parseInt(n, 10);
    if (!n || n < PER_COL_MIN) return PER_COL_DEFAULT;
    if (n > PER_COL_MAX) return PER_COL_MAX;
    return n;
  }

  function nearest_(list, raw, fallback) {
    const n = parseFloat(raw);
    if (!n || isNaN(n)) return fallback;
    let best = list[0];
    let diff = Math.abs(n - best);
    for (let i = 1; i < list.length; i++) {
      const d = Math.abs(n - list[i]);
      if (d < diff) {
        best = list[i];
        diff = d;
      }
    }
    return best;
  }

  function clampFont_(n) {
    return nearest_(FONT_SIZES, n, FONT_DEFAULT);
  }

  function clampLh_(n) {
    return nearest_(LINE_HEIGHTS, n, LH_DEFAULT);
  }

  function lsGet_(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function lsSet_(key, val) {
    try { localStorage.setItem(key, String(val)); } catch (e) { /* ignore */ }
  }

  function loadPerCol_() {
    return clampPerCol_(lsGet_(PER_COL_KEY, PER_COL_DEFAULT));
  }

  function savePerCol_(n) {
    lsSet_(PER_COL_KEY, clampPerCol_(n));
  }

  function loadFont_() {
    return clampFont_(lsGet_(FONT_KEY, FONT_DEFAULT));
  }

  function saveFont_(n) {
    lsSet_(FONT_KEY, clampFont_(n));
  }

  function loadLh_() {
    return clampLh_(lsGet_(LH_KEY, LH_DEFAULT));
  }

  function saveLh_(n) {
    lsSet_(LH_KEY, clampLh_(n));
  }

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
    return String(c.text || c || '').indexOf('わからない') >= 0;
  }

  function paperChoices_(q) {
    return (q.choices || []).filter(function (c) { return !isUnknownChoice_(c); });
  }

  function paperLabel_(s) {
    return String(s || '').replace(/タイピング/g, '記述');
  }

  function formatMeta_(q) {
    const f = String(q.format || '');
    const vmap = (typeof window !== 'undefined' && window.VOCAB_FORMAT_MAP) || {};
    const gmap = (typeof window !== 'undefined' && window.GRAMMAR_FORMAT_MAP) || {};
    const vlist = (typeof window !== 'undefined' && window.VOCAB_FORMATS) || [];
    const glist = (typeof window !== 'undefined' && window.GRAMMAR_FORMATS) || [];
    let found = vmap[f] || gmap[f] || null;
    if (!found) {
      for (let i = 0; i < vlist.length; i++) {
        if (vlist[i].key === f) { found = vlist[i]; break; }
      }
    }
    if (!found) {
      for (let i = 0; i < glist.length; i++) {
        if (glist[i].key === f) { found = glist[i]; break; }
      }
    }
    if (found) {
      return {
        key: f,
        label: paperLabel_(found.label || f),
        instruction: String(found.instruction || '')
      };
    }
    return { key: f || '?', label: paperLabel_(q.vocabFormatLabel || f || ''), instruction: '' };
  }

  function formatKeyDisp_(key) {
    if (/^[A-H]$/.test(key)) return '形式' + key;
    return '形式' + key;
  }

  function isGrammarQ_(q) {
    const f = String(q.format || '');
    return /^[A-H]$/.test(f) || !!(q.grammarArea || q.rowId);
  }

  function explanationOf_(q) {
    if (!isGrammarQ_(q)) return '';
    const fn = window.normalizeExplanationField_;
    return fn ? fn(q.explanation) : String(q.explanation || '').trim();
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

  function clozeText_(q, filled) {
    const prefix = q.answerPrefix || q.mcqPrefix || '';
    const suffix = q.answerSuffix || q.mcqSuffix || '';
    const inner = filled
      ? ('(' + filled + ')')
      : '(　)';
    if (prefix || suffix) return joinEn_(prefix, inner, suffix);
    return '';
  }

  function hasCloze_(q) {
    return !!(q.answerPrefix || q.mcqPrefix || q.answerSuffix || q.mcqSuffix);
  }

  function stemJa_(q) {
    return String(q.japanese || q.promptJa || '').trim();
  }

  function stemEn_(q) {
    if (q.format === 'H') return String(q.presentedSentence || '');
    if (q.promptEn) return String(q.promptEn);
    const f = String(q.format || '');
    if (q.word && (f.indexOf('enja') >= 0 || (!stemJa_(q) && f !== 'vocab-jaen'))) {
      return String(q.word);
    }
    return '';
  }

  function choiceGridHtml_(choices, mode) {
    let html = '<div class="pq-choice-grid">';
    choices.forEach(function (c, i) {
      const mark = CHOICE_MARKS[i] || String(i + 1);
      const on = mode === 'key' && c.isCorrect;
      html += '<div class="pq-ch' + (on ? ' is-ok' : '') + '">';
      html += '<span class="pq-mark">' + mark + '</span> ' + escapeHtml_(c.text || '');
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function tokensLine_(tokens) {
    if (!tokens || !tokens.length) return '';
    return tokens.map(function (t) { return escapeHtml_(t); }).join(' / ');
  }

  function sectionHeadHtml_(q, sectionCount, sectionNo) {
    const meta = formatMeta_(q);
    const prefix = sectionCount > 1 ? ('セクション' + sectionNo + '　') : '';
    const instr = meta.instruction || '';
    const line = prefix + formatKeyDisp_(meta.key) + '：【' + meta.label + '】' + (instr ? instr : '');
    let html = '<div class="pq-sec">' + escapeHtml_(line) + '</div>';
    if (q.sharedPool && q.sharedPool.length) {
      html += '<div class="pq-bank">語群　' + q.sharedPool.map(function (t) {
        return escapeHtml_(t);
      }).join('　／　') + '</div>';
    }
    return html;
  }

  function itemHtml_(item, mode) {
    const q = item.q;
    const isKey = mode === 'key';
    const correct = correctTextOf_(q);
    const choices = paperChoices_(q);
    const ja = stemJa_(q);
    const cloze = clozeText_(q, isKey ? (q.expectedInner || q.mcqAnswer || '') : '');
    const en = cloze || stemEn_(q);
    const f = String(q.format || '');

    let html = '<article class="pq-item">';
    html += '<div class="pq-l1"><span class="pq-no">' + item.no + '.</span> '
      + escapeHtml_(ja || (f === 'H' ? '' : (en && !ja ? en : ''))) + '</div>';

    if (f === 'H') {
      html += '<div class="pq-l2">' + escapeHtml_(q.presentedSentence || '') + '</div>';
      if (isKey) html += '<div class="pq-l3"><span class="pq-fill">' + escapeHtml_(correct) + '</span></div>';
      else html += '<div class="pq-l3">□ 正しい　□ 誤っている</div>';
    } else if (f === 'E' || f === 'C' || f === 'D') {
      html += '<div class="pq-l2">' + (cloze ? escapeHtml_(cloze) : '') + '</div>';
      html += '<div class="pq-l2b">' + tokensLine_(q.poolTokens) + '</div>';
      if (isKey) {
        html += '<div class="pq-l3"><span class="pq-fill">' + escapeHtml_(correct) + '</span></div>';
      } else {
        html += '<div class="pq-gap"></div><div class="pq-uline"></div>';
      }
    } else if (choices.length) {
      if (en && ja) html += '<div class="pq-l2">' + escapeHtml_(en) + '</div>';
      else if (en && !ja) { /* already on l1 */ }
      else if (cloze) html += '<div class="pq-l2">' + escapeHtml_(cloze) + '</div>';
      html += choiceGridHtml_(choices, mode);
    } else {
      if (en && ja) html += '<div class="pq-l2">' + escapeHtml_(en) + '</div>';
      if (isKey) {
        html += '<div class="pq-l3"><span class="pq-fill">' + escapeHtml_(correct) + '</span></div>';
      } else {
        html += '<div class="pq-gap"></div><div class="pq-uline"></div>';
      }
    }

    if (isKey && isGrammarQ_(q)) {
      const exp = explanationOf_(q);
      const area = String(q.grammarArea || '').trim();
      if (area || exp) {
        html += '<div class="pq-exp">';
        if (area) html += '<span class="pq-exp-area">' + escapeHtml_(area) + '</span> ';
        if (exp) html += escapeHtml_(exp);
        html += '</div>';
      }
    }
    html += '</article>';
    return html;
  }

  function headerHtml_(meta, sheetKind) {
    const kind = sheetKind === 'key' ? '採点用模範解' : '問題用紙';
    const extra = sheetKind === 'key' ? '（別紙）' : '';
    let html = '<header class="pq-header">';
    html += '<div class="pq-title">' + escapeHtml_(kind) + extra + '　'
      + escapeHtml_(meta.title || '小テスト');
    if (meta.pointsMax) html += '　' + escapeHtml_(String(meta.count)) + '問／満点' + escapeHtml_(String(meta.pointsMax));
    else html += '　' + escapeHtml_(String(meta.count || '')) + '問';
    html += '</div>';
    html += '<div class="pq-idrow">'
      + '<span>学年</span><span class="pq-box"></span>'
      + '<span>組</span><span class="pq-box pq-box-sm"></span>'
      + '<span>番号</span><span class="pq-box pq-box-sm"></span>'
      + '<span>氏名</span><span class="pq-box pq-box-name"></span>'
      + '<span>点数</span><span class="pq-box pq-box-score"></span>'
      + '</div>';
    html += '</header>';
    return html;
  }

  function regroupByFormat_(items) {
    const order = [];
    const buckets = {};
    items.forEach(function (it) {
      const k = String((it.q && it.q.format) || 'other');
      if (!buckets[k]) {
        buckets[k] = [];
        order.push(k);
      }
      buckets[k].push(it);
    });
    const out = [];
    order.forEach(function (k) {
      buckets[k].forEach(function (it) { out.push(it); });
    });
    out.forEach(function (it, i) { it.no = i + 1; });
    return out;
  }

  function uniqueFormatCount_(items) {
    const seen = {};
    let n = 0;
    items.forEach(function (it) {
      const k = String((it.q && it.q.format) || '');
      if (!seen[k]) {
        seen[k] = true;
        n += 1;
      }
    });
    return n;
  }

  function pairGridHtml_(pageItems, mode, perCol) {
    let html = '<div class="pq-pair">';
    for (let r = 0; r < perCol; r++) {
      const left = pageItems[r];
      const right = pageItems[r + perCol];
      html += '<div class="pq-pair-row">';
      html += '<div class="pq-pair-cell">' + (left ? itemHtml_(left, mode) : '') + '</div>';
      html += '<div class="pq-pair-cell">' + (right ? itemHtml_(right, mode) : '') + '</div>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function splitFormatSections_(items) {
    const grouped = regroupByFormat_(items);
    const sections = [];
    grouped.forEach(function (it) {
      const k = String((it.q && it.q.format) || '');
      const last = sections[sections.length - 1];
      if (!last || last.key !== k) {
        sections.push({ key: k, items: [it] });
      } else {
        last.items.push(it);
      }
    });
    return sections;
  }

  function sheetHtml_(items, meta, mode, perCol) {
    perCol = clampPerCol_(perCol);
    const perPage = perCol * 2;
    const grouped = regroupByFormat_(items);
    const sections = splitFormatSections_(grouped);
    const sectionCount = sections.length;
    let html = '<section class="pq-sheet pq-sheet-' + mode + '">';
    sections.forEach(function (sec, si) {
      for (let p = 0; p < sec.items.length; p += perPage) {
        const pageItems = sec.items.slice(p, p + perPage);
        html += '<div class="pq-a4">';
        html += headerHtml_(meta, mode);
        html += sectionHeadHtml_(sec.items[0].q, sectionCount, si + 1);
        html += pairGridHtml_(pageItems, mode, perCol);
        html += '</div>';
      }
    });
    html += '</section>';
    return html;
  }

  function cssText_() {
    return [
      '* { box-sizing: border-box; }',
      'html, body { margin: 0; padding: 0; background: #e8e8e8; color: #111;',
      '  font-family: "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif; }',
      '.pq-toolbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;',
      '  padding: 10px 16px; background: #1e293b; color: #fff; }',
      '.pq-toolbar button { min-height: 40px; padding: 8px 14px; border-radius: 8px; border: 0; cursor: pointer; font-weight: 700; }',
      '.pq-toolbar .is-on { background: #38bdf8; color: #0f172a; }',
      '.pq-toolbar button:not(.is-on) { background: #334155; color: #fff; }',
      '.pq-toolbar label { font-size: 13px; display: flex; align-items: center; gap: 6px; }',
      '.pq-toolbar select { height: 36px; border-radius: 8px; padding: 0 8px; font-weight: 700; }',
      'body { --pq-fs: 9.5px; --pq-lh: 1.28; }',
      '.pq-a4 { width: 210mm; min-height: 297mm; margin: 12px auto; padding: 8mm 8mm 10mm; background: #fff;',
      '  box-shadow: 0 2px 10px rgba(0,0,0,.12); }',
      '.pq-a4 + .pq-a4, .pq-sheet-key { page-break-before: always; }',
      '.pq-sheet-key .pq-a4 + .pq-a4 { page-break-before: always; }',
      '.pq-header { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #111; padding-bottom: 5px; margin-bottom: 5px; }',
      '.pq-title { flex: 1; min-width: 0; font-size: calc(var(--pq-fs) + 2.5px); font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.pq-idrow { display: flex; align-items: center; gap: 5px; font-size: calc(var(--pq-fs) + 2.5px); flex-shrink: 0; white-space: nowrap; }',
      '.pq-idrow span { line-height: 1; }',
      '.pq-box { display: inline-block; border: 1.2px solid #111; height: 8mm; width: 12mm; vertical-align: middle; }',
      '.pq-box-sm { width: 10mm; }',
      '.pq-box-name { width: 32mm; }',
      '.pq-box-score { width: 16mm; }',
      '.pq-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; align-items: start; }',
      '.pq-sec { font-size: var(--pq-fs); font-weight: 700; line-height: var(--pq-lh); min-height: 2.5em; margin: 0 0 4px; }',
      '.pq-bank { font-size: calc(var(--pq-fs) * 0.95); line-height: var(--pq-lh); margin: 0 0 4px; }',
      '.pq-pair { display: flex; flex-direction: column; gap: 0; }',
      '.pq-pair-row { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; align-items: stretch; }',
      '.pq-pair-cell { min-height: 1px; }',
      '.pq-pair-cell .pq-item { height: 100%; }',
      '.pq-item { margin: 0 0 1.6mm; padding: 0; border: 0; font-size: var(--pq-fs); line-height: var(--pq-lh); break-inside: avoid; }',
      '.pq-l1, .pq-l2, .pq-l2b, .pq-l3 { word-break: break-word; overflow-wrap: anywhere; }',
      '.pq-no { font-weight: 800; }',
      '.pq-choice-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 4px; row-gap: 0; margin-top: 1px; font-size: var(--pq-fs); }',
      '.pq-ch.is-ok { font-weight: 800; }',
      '.pq-mark { font-weight: 700; }',
      '.pq-gap { height: 0.95em; }',
      '.pq-uline { border-bottom: 1px solid #111; height: 1.05em; }',
      '.pq-fill { font-weight: 800; color: #9a0000; }',
      '.pq-exp { font-size: calc(var(--pq-fs) * 0.9); line-height: var(--pq-lh); margin-top: 1px; color: #333; }',
      '.pq-exp-area { font-weight: 800; }',
      '@page { size: A4; margin: 8mm; }',
      '@media print {',
      '  body { background: #fff; }',
      '  .pq-toolbar { display: none !important; }',
      '  .pq-a4 { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }',
      '  body.print-q .pq-sheet-key { display: none !important; }',
      '  body.print-k .pq-sheet-question { display: none !important; }',
      '  body.print-k .pq-sheet-key { page-break-before: auto; }',
      '}'
    ].join('\n');
  }

  function toItems_(questions) {
    return (questions || []).map(function (q, i) {
      return { no: i + 1, q: q, points: q._pointsPerQuestion };
    });
  }

  function optionListHtml_(list, current, suffix) {
    let html = '';
    list.forEach(function (v) {
      html += '<option value="' + v + '"' + (v === current ? ' selected' : '') + '>' + v + suffix + '</option>';
    });
    return html;
  }

  function openPreview_(questions, meta, perCol) {
    perCol = clampPerCol_(perCol != null ? perCol : loadPerCol_());
    savePerCol_(perCol);
    const fontSize = loadFont_();
    const lineHeight = loadLh_();
    lastPreview_ = { questions: questions, meta: meta };
    const items = regroupByFormat_(toItems_(questions));
    if (!items.length) throw new Error('印刷できる問題がありません。');
    meta = Object.assign({ count: items.length }, meta || {});
    const qHtml = sheetHtml_(items, meta, 'question', perCol);
    const kHtml = sheetHtml_(items, meta, 'key', perCol);
    let colOpt = '';
    for (let n = PER_COL_MIN; n <= PER_COL_MAX; n++) {
      colOpt += '<option value="' + n + '"' + (n === perCol ? ' selected' : '') + '>' + n + '問</option>';
    }
    const html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>'
      + escapeHtml_(meta.title || '小テスト')
      + '</title><style>' + cssText_() + '</style></head>'
      + '<body class="print-both" style="--pq-fs:' + fontSize + 'px;--pq-lh:' + lineHeight + '">'
      + '<div class="pq-toolbar">'
      + '<button type="button" data-view="both" class="is-on">問題＋模範解</button>'
      + '<button type="button" data-view="q">問題用紙のみ</button>'
      + '<button type="button" data-view="k">採点用模範解のみ</button>'
      + '<label>1列の問数 <select id="pq-per-col">' + colOpt + '</select></label>'
      + '<label>文字サイズ <select id="pq-fs">' + optionListHtml_(FONT_SIZES, fontSize, 'px') + '</select></label>'
      + '<label>行の高さ <select id="pq-lh">' + optionListHtml_(LINE_HEIGHTS, lineHeight, '') + '</select></label>'
      + '<button type="button" class="pq-print" id="pq-do-print">印刷 / PDF</button>'
      + '<span style="font-size:12px;opacity:.85;">2列×' + perCol + '＝1枚最大' + (perCol * 2) + '問（1列は最大20問）</span>'
      + '</div>'
      + qHtml + kHtml
      + '<script>(function(){'
      + 'var b=document.body;document.querySelectorAll("[data-view]").forEach(function(btn){'
      + 'btn.addEventListener("click",function(){b.className="print-"+btn.getAttribute("data-view");'
      + 'document.querySelectorAll("[data-view]").forEach(function(x){x.classList.toggle("is-on",x===btn);});});});'
      + 'document.getElementById("pq-do-print").onclick=function(){window.print();};'
      + 'var sel=document.getElementById("pq-per-col");'
      + 'sel.onchange=function(){var op=window.opener;if(op&&op.PaperQuizModule&&op.PaperQuizModule.reprint){op.PaperQuizModule.reprint(sel.value);}else{alert("元の学習画面から開き直してください");}};'
      + 'function applyTypo(){'
      + 'var fs=document.getElementById("pq-fs").value;var lh=document.getElementById("pq-lh").value;'
      + 'b.style.setProperty("--pq-fs",fs+"px");b.style.setProperty("--pq-lh",lh);'
      + 'try{localStorage.setItem("dd_paper_quiz_font",fs);localStorage.setItem("dd_paper_quiz_lh",lh);}catch(e){}'
      + '}'
      + 'document.getElementById("pq-fs").onchange=applyTypo;'
      + 'document.getElementById("pq-lh").onchange=applyTypo;'
      + '})();<\/script></body></html>';

    const w = window.open('', 'paper-quiz');
    if (!w) throw new Error('印刷ウィンドウを開けませんでした。ポップアップを許可してください。');
    w.document.open();
    w.document.write(html);
    w.document.close();
    try { w.focus(); } catch (e) { /* ignore */ }
  }

  function reprint(perCol) {
    if (!lastPreview_) return;
    openPreview_(lastPreview_.questions, lastPreview_.meta, perCol);
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
        subtitle: '文法・語法演習',
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
        Promise.resolve(run).catch(function (e) { alert(e.message || e); });
      });
    }
    const vBtn = document.getElementById('vocab-paper-print-btn');
    if (vBtn && !vBtn._pqBound) {
      vBtn._pqBound = true;
      vBtn.addEventListener('click', function () {
        const run = window.BusyButton && BusyButton.run
          ? BusyButton.run(vBtn, openFromVocab, '用紙作成中…')
          : openFromVocab();
        Promise.resolve(run).catch(function (e) { alert(e.message || e); });
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
    reprint: reprint,
    bindUi: bindUiOnce_
  };
})();
window.PaperQuizModule = PaperQuizModule;
