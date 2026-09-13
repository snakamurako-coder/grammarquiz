/**
 * LIVE VOTE 選択肢セット — 種類・個数・独自選択肢の解決
 */
const LivePollChoiceSets = (function () {
  const KINDS = [
    { id: 'CIRCLED', label: '①②③' },
    { id: 'ABC', label: 'ABC' },
    { id: 'AIUE', label: 'あいう' },
    { id: 'KATAKANA', label: 'アイウ' },
    { id: 'ROMAN', label: 'ⅠⅡⅢ' },
    { id: 'TF', label: 'True / False' },
    { id: 'CUSTOM', label: '独自の選択肢' },
    { id: 'WRITTEN', label: '記述' }
  ];

  const HIRAGANA_POOL = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろ'.split('');
  const KATAKANA_POOL = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロ'.split('');
  const ROMAN_POOL = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];

  const LEGACY = {
    CIRCLED10: { kind: 'CIRCLED', count: 10 },
    KATAKANA5: { kind: 'KATAKANA', count: 5 },
    AIUE: { kind: 'AIUE', count: 4 }
  };

  function normalizeKind_(kind) {
    kind = String(kind || 'ABC').trim();
    if (LEGACY[kind]) return LEGACY[kind].kind;
    return kind;
  }

  function defaultCount_(kind) {
    kind = normalizeKind_(kind);
    if (kind === 'TF') return 2;
    if (kind === 'WRITTEN' || kind === 'CUSTOM') return 0;
    if (LEGACY[kind]) return LEGACY[kind].count;
    if (kind === 'ABC' || kind === 'CIRCLED' || kind === 'AIUE' || kind === 'KATAKANA' || kind === 'ROMAN') return 3;
    return 3;
  }

  function maxCount_(kind) {
    kind = normalizeKind_(kind);
    if (kind === 'CIRCLED') return 20;
    if (kind === 'ABC') return 26;
    if (kind === 'AIUE') return HIRAGANA_POOL.length;
    if (kind === 'KATAKANA') return KATAKANA_POOL.length;
    if (kind === 'ROMAN') return ROMAN_POOL.length;
    return 26;
  }

  function needsCount_(kind) {
    kind = normalizeKind_(kind);
    return kind === 'CIRCLED' || kind === 'ABC' || kind === 'AIUE' || kind === 'KATAKANA' || kind === 'ROMAN';
  }

  function needsCustom_(kind) {
    return normalizeKind_(kind) === 'CUSTOM';
  }

  function isWritten_(kind) {
    return normalizeKind_(kind) === 'WRITTEN';
  }

  function circledChar_(n) {
    if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
    return String(n);
  }

  function resolveConfig_(config) {
    config = config || {};
    let kind = String(config.choiceSet || config.kind || 'ABC').trim();
    let count = parseInt(config.choiceCount, 10);
    let customChoices = String(config.customChoices == null ? '' : config.customChoices);

    if (LEGACY[kind]) {
      if (isNaN(count) || count <= 0) count = LEGACY[kind].count;
      kind = LEGACY[kind].kind;
    }
    if (isNaN(count) || count <= 0) count = defaultCount_(kind);
    kind = normalizeKind_(kind);
    return { kind: kind, count: count, customChoices: customChoices };
  }

  function buildChoices(config) {
    const cfg = resolveConfig_(config);
    const kind = cfg.kind;
    if (kind === 'WRITTEN') return [];
    if (kind === 'TF') return ['True', 'False'];
    if (kind === 'CUSTOM') {
      return String(cfg.customChoices || '')
        .split(',')
        .map(function (s) { return String(s).trim(); })
        .filter(function (s) { return s.length > 0; });
    }
    const count = Math.min(maxCount_(kind), Math.max(1, cfg.count));
    if (kind === 'CIRCLED') {
      const out = [];
      for (let i = 1; i <= count; i++) out.push(circledChar_(i));
      return out;
    }
    if (kind === 'ABC') {
      const out = [];
      for (let i = 0; i < count; i++) out.push(String.fromCharCode(65 + i));
      return out;
    }
    if (kind === 'AIUE') return HIRAGANA_POOL.slice(0, count);
    if (kind === 'KATAKANA') return KATAKANA_POOL.slice(0, count);
    if (kind === 'ROMAN') return ROMAN_POOL.slice(0, count);
    return [];
  }

  function validate(config) {
    const cfg = resolveConfig_(config);
    if (cfg.kind === 'WRITTEN') return { ok: true, config: cfg };
    if (cfg.kind === 'TF') return { ok: true, config: cfg };
    if (cfg.kind === 'CUSTOM') {
      const choices = buildChoices(cfg);
      if (choices.length < 2) {
        return { ok: false, error: '独自の選択肢は2つ以上、カンマ区切りで入力してください' };
      }
      return { ok: true, config: cfg, choices: choices };
    }
    if (!needsCount_(cfg.kind)) {
      return { ok: false, error: '選択肢の種類が不正です' };
    }
    const max = maxCount_(cfg.kind);
    if (cfg.count < 2) return { ok: false, error: '選択肢は2つ以上にしてください' };
    if (cfg.count > max) return { ok: false, error: '選択肢の数は最大 ' + max + ' までです' };
    const choices = buildChoices(cfg);
    if (choices.length < 2) return { ok: false, error: '選択肢を生成できません' };
    return { ok: true, config: cfg, choices: choices };
  }

  function kindOptionsHtml(selected) {
    selected = normalizeKind_(selected);
    return KINDS.map(function (k) {
      return '<option value="' + k.id + '"' + (k.id === selected ? ' selected' : '') + '>' + k.label + '</option>';
    }).join('');
  }

  function previewText(config) {
    const v = validate(config);
    if (!v.ok) return v.error || '';
    if (v.config.kind === 'WRITTEN') return '記述（自由入力）';
    if (v.config.kind === 'TF') return 'True / False';
    return (v.choices || buildChoices(v.config)).join(' ');
  }

  function parseAnswerList(raw) {
    if (raw == null || raw === '') return [];
    if (Array.isArray(raw)) {
      return raw.map(function (s) { return String(s == null ? '' : s).trim(); })
        .filter(function (s) { return s.length > 0; });
    }
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (!s) return [];
      if (s.charAt(0) === '[') {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) return parseAnswerList(parsed);
        } catch (e) { /* treat as plain text */ }
      }
      return [s];
    }
    return [];
  }

  function formatAnswerList(raw) {
    return parseAnswerList(raw).join(' / ');
  }

  function isCorrectAnswer(ownAnswer, revealed, type) {
    if (type === 'written') {
      const list = parseAnswerList(revealed);
      const own = String(ownAnswer == null ? '' : ownAnswer);
      if (!list.length || !String(own).trim()) return false;
      const normOwn = own.replace(/[\uFF01-\uFF5E]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
      }).replace(/\u3000/g, ' ').replace(/[ \t\r\n]+/g, ' ').trim();
      return list.some(function (ans) {
        const n = String(ans).replace(/[\uFF01-\uFF5E]/g, function (ch) {
          return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
        }).replace(/\u3000/g, ' ').replace(/[ \t\r\n]+/g, ' ').trim();
        return n === normOwn;
      });
    }
    const list = parseAnswerList(revealed);
    return list.indexOf(String(ownAnswer)) >= 0;
  }

  return {
    KINDS: KINDS,
    normalizeKind: normalizeKind_,
    defaultCount: defaultCount_,
    maxCount: maxCount_,
    needsCount: needsCount_,
    needsCustom: needsCustom_,
    isWritten: isWritten_,
    resolveConfig: resolveConfig_,
    buildChoices: buildChoices,
    validate: validate,
    kindOptionsHtml: kindOptionsHtml,
    previewText: previewText,
    parseAnswerList: parseAnswerList,
    formatAnswerList: formatAnswerList,
    isCorrectAnswer: isCorrectAnswer
  };
})();

window.LivePollChoiceSets = LivePollChoiceSets;
