'use strict';

const DAY_MS = 86400000;
const WEEKDAYS = '日月火水木金土';

// /admin で開いたときだけ編集モード（/admin は Cloudflare Access でログインした本人だけが開ける）
const EDITABLE = /^\/admin\/?$/.test(location.pathname);
const ADMIN_API = '/admin/api';

// week：週の欄に出している週（その週の月曜日）。flash：直前に完了したタスク（今週の欄で光らせる）
const state = { doc: null, editable: EDITABLE, openMemos: new Set(), week: null, flash: null };
const $ = (sel) => document.querySelector(sel);

// ---------- 日付（すべてローカル日付の 'YYYY-MM-DD' で扱う） ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const dayNum = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };
const diffDays = (from, to) => dayNum(to) - dayNum(from);
const addDays = (s, n) => new Date((dayNum(s) + n) * DAY_MS).toISOString().slice(0, 10);
const fmtMD = (s) => { const [, m, d] = s.split('-'); return `${+m}/${+d}`; };
const fmtMDW = (s) => `${fmtMD(s)}(${WEEKDAYS[new Date(dayNum(s) * DAY_MS).getUTCDay()]})`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const findTask = (id) => state.doc.tasks.find((t) => t.id === id);
const findRecord = (id) => state.doc.records.find((r) => String(r.id) === String(id));

// ---------- 期限 ----------
function dueInfo(deadline) {
  const left = diffDays(today(), deadline);
  if (left < 0) return { cls: 'over', left, text: `${-left}日超過` };
  if (left === 0) return { cls: 'today', left, text: '今日まで' };
  return { cls: left <= 2 ? 'hot' : left <= 7 ? 'warm' : 'calm', left, text: `${fmtMDW(deadline)}まで・あと${left}日` };
}

// ---------- 週（月曜始まり）と人生の週 ----------
// 週はその週の月曜日の日付で表す。人生の週のマスは、1行＝1歳（誕生日を含む週から、次の誕生日を含む週の前まで。52か53マス）
const mondayOf = (s) => addDays(s, -((new Date(dayNum(s) * DAY_MS).getUTCDay() + 6) % 7));
const birthdayOf = (age) => { const [by, bm, bd] = state.doc.owner.birthday.split('-').map(Number); return `${by + age}-${pad(bm)}-${pad(bd)}`; };
function ageAt(dateStr) {
  const [by, bm, bd] = state.doc.owner.birthday.split('-').map(Number);
  const [y, m, d] = dateStr.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
const rowStart = (age) => mondayOf(birthdayOf(age)); // その歳の行の最初の週
const ageOfWeek = (monday) => { let a = ageAt(addDays(monday, 6)); while (a > 0 && rowStart(a) > monday) a--; return a; };

// ---------- データ読み書き ----------
async function load() {
  const res = await fetch('/api/data', { cache: 'no-store' });
  if (!res.ok) { $('#mode').textContent = `読み込めませんでした (${res.status})`; return; }
  state.doc = await res.json();
  if (!state.week) state.week = mondayOf(today());
  render();
}

// 書き込み。全体が返ってくるので描き直す。エラーなら文字列を返す。
// quiet: 描き直さない（メモの自動保存で、入力中の欄を壊さないため）
async function send(method, path, body, okMsg = '保存しました', { quiet = false } = {}) {
  let res;
  try {
    res = await fetch(ADMIN_API + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      redirect: 'manual', // Access のセッションが切れると、ログイン画面への 302 になる
    });
  } catch {
    return '通信できませんでした';
  }
  if (res.type === 'opaqueredirect' || res.status === 403) return 'ログインが切れています。ページを読み込み直してください';
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return j.error || `保存に失敗しました (${res.status})`;
  state.doc = j;
  if (!quiet) { render(); if (okMsg) toast(okMsg); }
}
async function sendNow(...args) {
  const err = await send(...args);
  if (err) alert(err);
}

// ---------- 描画 ----------
function render() {
  renderTime();
  renderTasks();
  renderWeek();
  renderLife();
  $('#quick-add').hidden = !state.editable;
  $('#mode').innerHTML = state.editable
    ? '編集モード — <a href="/">公開画面で見る</a>'
    : '閲覧モード — このリストは本人が自分を動かすために公開しています（<a href="/admin">編集</a>）';
}

function renderTime() {
  const { birthday, lifespanYears } = state.doc.owner;
  const now = new Date();
  const lived = diffDays(mondayOf(birthday), mondayOf(today())) / 7;
  const total = diffDays(mondayOf(birthday), rowStart(lifespanYears)) / 7;
  const age = ageAt(today());

  const monday = new Date(now); monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekLeftMs = monday.getTime() + 7 * DAY_MS - now.getTime();
  const wd = Math.floor(weekLeftMs / DAY_MS);
  const wh = Math.floor((weekLeftMs % DAY_MS) / 3600000);

  const y = now.getFullYear();
  const yearDays = diffDays(`${y}-01-01`, `${y + 1}-01-01`);
  const yearLeft = diffDays(today(), `${y + 1}-01-01`);

  const meter = (k, v, ratio) =>
    `<div class="meter"><div class="k">${k}</div><div class="v">${v}</div><div class="bar"><i style="width:${(ratio * 100).toFixed(1)}%"></i></div></div>`;
  $('#time').innerHTML =
    meter('今週', `残り ${wd}日${wh}時間`, 1 - weekLeftMs / (7 * DAY_MS)) +
    meter(`${y}年`, `残り ${yearLeft}日`, 1 - yearLeft / yearDays) +
    meter('人生', `残り ${(total - lived).toLocaleString()}週 <small>${age}歳・${lifespanYears}歳まで</small>`, lived / total);
}

function renderTasks() {
  const open = state.doc.tasks
    .filter((t) => t.status === 'open')
    // 手で並べた順（sort）。同じ値どうしは、期限のあるものを近い順に先に、期限のないものは登録順で後ろに
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.deadline && b.deadline ? a.deadline.localeCompare(b.deadline) : a.deadline ? -1 : b.deadline ? 1 : a.created.localeCompare(b.created)));
  $('#task-count').textContent = open.length;
  $('#tasks').innerHTML = open.length ? open.map(taskRow).join('') : '<li class="empty">タスクはありません。</li>';
  document.querySelectorAll('#tasks textarea[data-memo]').forEach(autosize);

  // メモをまとめて開く・閉じる（書き込みのあるメモが対象）
  const withMemo = open.filter((t) => t.memo);
  const allOpen = withMemo.length > 0 && withMemo.every((t) => state.openMemos.has(t.id));
  $('#memo-all').innerHTML = withMemo.length
    ? `<button class="btn sm" data-act="memo-all">${allOpen ? '▾ メモをすべて閉じる' : '▸ メモをすべて開く'}</button>`
    : '';

  const done = state.doc.tasks.filter((t) => t.status === 'done').sort((a, b) => b.done.localeCompare(a.done));
  $('#done-count').textContent = done.length;
  $('#done').innerHTML = done.length
    ? done.map((t) => `<li class="task is-done">
        <div class="task-line">
          <span class="done-mark" aria-hidden="true">✓</span>
          <span class="task-title">${esc(t.title)}</span>
          <span class="when">${fmtMD(t.done)} 完了</span>
          ${state.editable ? `<span class="task-ops"><button class="btn sm" data-act="reopen" data-id="${t.id}">未完了に戻す</button></span>` : ''}
        </div></li>`).join('')
    : '<li class="empty">まだありません。</li>';

  const urgent = open.filter((t) => t.deadline && dueInfo(t.deadline).left <= 0).length;
  document.title = urgent ? `(${urgent}) todo` : 'todo';
}

function taskRow(t) {
  const ed = state.editable;
  const d = t.deadline ? dueInfo(t.deadline) : null;
  const isOpen = state.openMemos.has(t.id);
  const hasMemo = !!t.memo;
  const memo = isOpen
    ? `<div class="memo">${ed
        ? `<textarea data-memo="${t.id}" rows="1" placeholder="メモ">${esc(t.memo)}</textarea><div class="memo-err" data-memo-status="${t.id}" hidden></div>`
        : `<div class="memo-text">${esc(t.memo)}</div>`}</div>`
    : '';
  // メモはカードのどこを押しても開閉する（ボタンや入力欄を除く）。開閉は左の三角で、書き込みがあることはタイトルの右の
  // メモのアイコン（≡）で示す。閲覧モードでメモがないカードは開かない（三角は場所だけ空けて、タイトルの位置をそろえる）
  const openable = ed || hasMemo;
  return `<li class="task${d ? ` u-${d.cls}` : ''}${openable ? ' openable' : ''}${isOpen ? ' open' : ''}" data-task="${t.id}">
    <div class="task-line">
      ${ed ? `<span class="grip" data-grip title="ドラッグで並べ替え" aria-hidden="true">${GRIP}</span>` : ''}
      ${openable
        ? `<button class="twisty" data-act="memo" data-id="${t.id}" aria-expanded="${isOpen}" aria-label="メモを${isOpen ? '閉じる' : '開く'}">▸</button>`
        : '<span class="twisty" aria-hidden="true"></span>'}
      <span class="task-main">
        <span class="task-title">${esc(t.title)}${hasMemo ? ` <span class="memo-icon" title="メモあり" aria-label="メモあり">${LINES}</span>` : ''}</span>
        ${d ? `<span class="due d-${d.cls}">${d.text}</span>` : ''}
      </span>
      <span class="task-ops">
        ${ed ? `<button class="btn sm" data-act="log" data-id="${t.id}" title="完了にはせず、今日進めたことを「やったこと」に書く">＋ やったこと</button>
        <button class="btn sm done-btn" data-act="done" data-id="${t.id}">✓ 完了</button>
        <button class="btn sm more" data-act="edit" data-id="${t.id}" title="タイトル・期限の変更、削除" aria-label="タイトル・期限の変更、削除">⋯</button>` : ''}
      </span>
    </div>
    ${memo}
  </li>`;
}

const LINES = '<svg width="12" height="10" viewBox="0 0 12 10"><g stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 1.5h10M1 5h10M1 8.5h6"/></g></svg>';
const GRIP = '<svg width="8" height="14" viewBox="0 0 8 14"><g fill="currentColor"><circle cx="2" cy="3" r="1.2"/><circle cx="6" cy="3" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="11" r="1.2"/><circle cx="6" cy="11" r="1.2"/></g></svg>';

// タスクの「＋ やったこと」から書いた記録には、どのタスクのものかを小さく添える（完了の記録は文がタイトルそのものなので添えない）
function recTask(r) {
  if (r.kind === 'done' || !r.taskId) return '';
  const t = findTask(r.taskId);
  return t ? ` <span class="rec-task" title="${esc(t.title)}">${esc(t.title)}</span>` : '';
}

// 選んでいる週にやったこと（既定は今週）
function renderWeek() {
  const start = state.week;
  const end = addDays(start, 6);
  const thisWeek = mondayOf(today());
  const isNow = start === thisWeek;
  const future = start > thisWeek;
  const list = state.doc.records.filter((r) => mondayOf(r.date) === start);

  $('#week-title').innerHTML = `<span>${isNow ? '今週やったこと' : `${fmtMD(start)}〜${fmtMD(end)}の週にやったこと`}
      <span class="count">${isNow ? `${fmtMD(start)}〜${fmtMD(end)}` : `${ageOfWeek(start)}歳`}</span></span>
    <span class="week-nav">
      <button class="btn sm" data-act="week-move" data-id="-7" aria-label="前の週">← 前の週</button>
      ${isNow ? '' : '<button class="btn sm" data-act="week-now">今週</button>'}
      <button class="btn sm" data-act="week-move" data-id="7" aria-label="次の週" ${future || isNow ? 'disabled' : ''}>次の週 →</button>
    </span>`;

  const items = list.map((r) => `<li class="rec${r.kind === 'done' && r.taskId && r.taskId === state.flash ? ' flash' : ''}">
      <span class="when">${fmtMDW(r.date)}</span>
      <span class="rec-text">${r.kind === 'done' ? '<span class="done-mark">✓</span> ' : ''}${esc(r.text)}${recTask(r)}</span>
      ${state.editable ? `<span class="task-ops">
        <button class="btn sm more" data-act="rec-edit" data-id="${r.id}" title="書き直す、消す" aria-label="書き直す、消す">⋯</button>
      </span>` : ''}
    </li>`);
  $('#week-list').innerHTML = items.length ? items.join('') : `<li class="empty">${future ? 'まだ来ていない週です。' : 'まだ何もありません。'}</li>`;
  state.flash = null;

  const form = $('#week-add');
  form.hidden = !state.editable || future;
  if (!form.hidden) {
    const max = end < today() ? end : today();
    form.elements.date.min = start;
    form.elements.date.max = max;
    if (!form.elements.date.value || form.elements.date.value < start || form.elements.date.value > max) form.elements.date.value = max;
  }
}

function renderLife() {
  const { lifespanYears } = state.doc.owner;
  const thisWeek = mondayOf(today());
  const recAt = new Map();
  for (const r of state.doc.records) {
    const k = mondayOf(r.date);
    recAt.set(k, [...(recAt.get(k) || []), r.text]);
  }

  // SVG で描く。1マス10、間隔2、10年ごとに少し空ける。左端は年齢ラベル。
  // 1行は52マスにそろえる。53週ある歳（5〜6年に1回）は、最後のマスに2週ぶんをまとめる
  const CELL = 10, GAP = 2, STEP = CELL + GAP, LABEL = 26, DECADE = 6, COLS = 52;
  const yOf = (age) => age * STEP + Math.floor(age / 10) * DECADE;
  let svg = '';
  for (let age = 0; age < lifespanYears; age++) {
    const y = yOf(age);
    if (age % 10 === 0) svg += `<text x="${LABEL - 6}" y="${y + CELL - 1}" text-anchor="end">${age}</text>`;
    const start = rowStart(age);
    const n = diffDays(start, rowStart(age + 1)) / 7;
    for (let w = 0; w < COLS; w++) {
      const weeks = [addDays(start, w * 7)];
      if (w === COLS - 1 && n > COLS) weeks.push(addDays(start, COLS * 7));
      const first = weeks[0], last = weeks[weeks.length - 1];
      const cls = [];
      if (first <= thisWeek) cls.push('lived'); // 今週も、始まっている週として塗る
      const recs = weeks.flatMap((k) => recAt.get(k) || []);
      // やったことの量で緑の濃さを変える（1件／2件／3〜4件／5件以上）
      if (recs.length) cls.push(`d${recs.length >= 5 ? 4 : recs.length >= 3 ? 3 : recs.length}`);
      if (weeks.includes(state.week)) cls.push('sel');
      const tips = [`${fmtMD(first)}〜${fmtMD(addDays(last, 6))}（${age}歳${weeks.length > 1 ? '・2週ぶん' : ''}）`, ...recs.slice(0, 6).map((s) => `・${s}`), ...(recs.length > 6 ? [`ほか${recs.length - 6}件`] : [])];
      // 押したときに選ぶ週：今週を含むなら今週、それ以外は最初の週
      const pick = weeks.includes(thisWeek) ? thisWeek : first;
      svg += `<rect data-week="${pick}" x="${LABEL + w * STEP}" y="${y}" width="${CELL}" height="${CELL}" rx="1.5" class="${cls.join(' ')}"><title>${esc(tips.join('\n'))}</title></rect>`;
    }
  }
  const width = LABEL + COLS * STEP - GAP;
  const height = yOf(lifespanYears - 1) + CELL;
  $('#life').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="人生の週: ${ageAt(today())}歳">${svg}</svg>`;
}

// ---------- フォーム ----------
// danger：左下に出す破壊的な操作（削除など）。{ label, confirm, onClick }。onClick がエラーを返せば表示する
function openForm({ title, intro, fields, submit, onSubmit, danger }) {
  const dlg = $('#dlg');
  dlg.innerHTML = `<form class="form" novalidate>
    <h2>${esc(title)}</h2>${intro ? `<p class="intro">${intro}</p>` : ''}
    ${fields.map((f) => `<div class="field"><label for="f-${f.name}">${esc(f.label)}</label>
      ${f.type === 'textarea'
        ? `<textarea name="${f.name}" id="f-${f.name}" rows="${f.rows || 3}">${esc(f.value)}</textarea>`
        : `<input type="${f.type || 'text'}" name="${f.name}" id="f-${f.name}" value="${esc(f.value)}" ${f.min ? `min="${f.min}"` : ''} ${f.max ? `max="${f.max}"` : ''}>`}
      ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`).join('')}
    <p class="err" hidden></p>
    <div class="form-actions">
      ${danger ? `<button type="button" class="btn danger" data-danger>${esc(danger.label)}</button>` : ''}
      <button type="button" class="btn ghost" data-close>キャンセル</button>
      <button class="btn primary">${esc(submit)}</button>
    </div>
  </form>`;
  const form = dlg.querySelector('form');
  const errEl = form.querySelector('.err');
  form.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  form.querySelector('[data-danger]')?.addEventListener('click', async () => {
    if (!confirm(danger.confirm)) return;
    const err = await danger.onClick();
    if (err) { errEl.hidden = false; errEl.textContent = err; return; }
    dlg.close();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));
    const err = await onSubmit(values);
    if (err) { errEl.hidden = false; errEl.textContent = err; return; }
    dlg.close();
  });
  dlg.showModal();
  (form.querySelector('input, textarea') || form.querySelector('.btn.primary'))?.focus();
}

// ---------- 操作 ----------
const actions = {
  memo(id) {
    if (state.openMemos.has(id)) state.openMemos.delete(id); else state.openMemos.add(id);
    renderTasks();
    // 空のメモを開いたときだけ、すぐ書けるようにカーソルを置く（読むために開いたときは、スマホでキーボードを出さない）
    if (state.editable && state.openMemos.has(id) && !findTask(id)?.memo) document.querySelector(`[data-memo="${id}"]`)?.focus();
  },
  'memo-all'() {
    const withMemo = state.doc.tasks.filter((t) => t.status === 'open' && t.memo);
    const allOpen = withMemo.every((t) => state.openMemos.has(t.id));
    state.openMemos = allOpen ? new Set() : new Set(withMemo.map((t) => t.id));
    renderTasks();
  },
  done(id) {
    const t = findTask(id);
    openForm({
      title: '完了にしますか？',
      intro: `「${esc(t.title)}」<br>完了にすると、今週の「やったこと」に記録され、タスクは下の「完了」に移ります（あとから戻せます）。`,
      fields: [],
      submit: '完了にする',
      onSubmit: () => {
        state.week = mondayOf(today()); // 記録が入った今週を見せる
        state.flash = id;
        return send('POST', `/tasks/${id}/done`, {}, `「${t.title}」を完了にしました。今週のやったことに入りました`);
      },
    });
  },
  reopen(id) { sendNow('POST', `/tasks/${id}/reopen`, {}, '未完了に戻しました（記録からも消えました）'); },
  edit(id) {
    const t = findTask(id);
    openForm({
      title: 'タスクを編集',
      intro: 'メモはタスクの「メモ」から書きます。',
      fields: [
        { name: 'title', label: 'タイトル', value: t.title },
        { name: 'deadline', label: '期限（空にすると期限なし）', type: 'date', value: t.deadline || '' },
      ],
      submit: '保存',
      onSubmit: (v) => send('PATCH', `/tasks/${id}`, v),
      danger: {
        label: '削除',
        confirm: `「${t.title}」を削除しますか？（やったことの記録は残ります）`,
        onClick: () => send('DELETE', `/tasks/${id}`, undefined, '削除しました'),
      },
    });
  },
  // タスクから、今日やったことを記録する（完了しなくても）
  log(id) {
    const t = findTask(id);
    openForm({
      title: 'やったことに書く',
      intro: `「${esc(t.title)}」で進めたことを書きます。完了にはせず、タスクはそのまま残ります。`,
      fields: [
        { name: 'text', label: 'やったこと', type: 'textarea', rows: 2, value: '' },
        { name: 'date', label: '日付', type: 'date', value: today(), max: today() },
      ],
      submit: '記録する',
      onSubmit: (v) => send('POST', '/records', { ...v, taskId: id }, '記録しました'),
    });
  },
  'week-now'() { state.week = mondayOf(today()); renderWeek(); renderLife(); },
  'week-move'(days) { state.week = addDays(state.week, Number(days)); renderWeek(); renderLife(); },
  'rec-edit'(id) {
    const r = findRecord(id);
    openForm({
      title: 'やったことを編集',
      fields: [
        { name: 'text', label: 'やったこと', type: 'textarea', rows: 2, value: r.text },
        { name: 'date', label: '日付', type: 'date', value: r.date, max: today() },
      ],
      submit: '保存',
      onSubmit: (v) => send('PATCH', `/records/${id}`, v),
      danger: {
        label: '消す',
        confirm: `「${r.text}」を記録から消しますか？`,
        onClick: () => send('DELETE', `/records/${id}`, undefined, '消しました'),
      },
    });
  },
};

document.addEventListener('click', (e) => {
  const cell = e.target.closest('rect[data-week]');
  if (cell) {
    state.week = cell.dataset.week;
    renderWeek(); renderLife();
    $('#week').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) { e.preventDefault(); actions[b.dataset.act](b.dataset.id); return; }
  // タスクのカードを押したらメモを開閉する。ボタン・つまみ・入力欄は除き、文字を選んでいるときも開閉しない
  const card = e.target.closest('#tasks > .task.openable');
  if (card && !e.target.closest('button, a, input, textarea, [data-grip], .memo') && !String(getSelection())) actions.memo(card.dataset.task);
});

// メモは打つそばから保存する（止まって1秒後、または欄を離れたとき）。保存ボタンはなく、保存の状態も出さない（失敗したときだけ出す）
// まだ送っていない書きかけ（memoDirty）は、ページを閉じる・読み込み直す・別のタブに移るときにも送る
const memoTimers = new Map();
const memoDirty = new Map(); // id -> 書きかけの textarea
async function saveMemo(el) {
  const id = el.dataset.memo;
  clearTimeout(memoTimers.get(id));
  const t = findTask(id);
  if (!t || el.value.trim() === (t.memo || '')) { memoDirty.delete(id); return; }
  const err = await send('PATCH', `/tasks/${id}`, { memo: el.value }, '', { quiet: true });
  if (!err) memoDirty.delete(id);
  const status = document.querySelector(`[data-memo-status="${id}"]`);
  if (status) { status.hidden = !err; status.textContent = err ? `保存できませんでした：${err}` : ''; }
  if (!document.activeElement?.matches(`[data-memo="${id}"]`)) renderTasks();
}
function flushMemos() {
  for (const [id, el] of memoDirty) {
    clearTimeout(memoTimers.get(id));
    // keepalive：ページが閉じても送信を最後まで続ける
    fetch(`${ADMIN_API}/tasks/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memo: el.value }), keepalive: true });
  }
  memoDirty.clear();
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.matches('[data-memo]')) return;
  const id = el.dataset.memo;
  memoDirty.set(id, el);
  clearTimeout(memoTimers.get(id));
  memoTimers.set(id, setTimeout(() => saveMemo(el), 1000));
  autosize(el);
});
// メモの欄は中身の高さに合わせて伸び縮みさせる（スクロールさせない）
function autosize(el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; }
document.addEventListener('focusout', (e) => { if (e.target.matches?.('[data-memo]')) saveMemo(e.target); });
window.addEventListener('pagehide', flushMemos);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushMemos(); });

document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (form.id === 'quick-add') {
    e.preventDefault();
    const title = form.elements.title.value.trim();
    if (!title) return;
    const err = await send('POST', '/tasks', { title, deadline: form.elements.deadline.value }, '追加しました');
    if (err) alert(err);
    else { form.reset(); form.elements.title.focus(); }
  } else if (form.id === 'week-add') {
    e.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) return;
    const err = await send('POST', '/records', { text, date: form.elements.date.value }, '記録しました');
    if (err) alert(err);
    else { $('#week-add').elements.text.value = ''; $('#week-add').elements.text.focus(); }
  }
});

// ---------- 並べ替え（左端のつまみをドラッグ。マウスでも指でも） ----------
// 掴んだカードは指に付いて1px単位で動く（transform でずらす）。ほかのカードは、入れ替わるたびに
// 元の位置から新しい位置へ滑らせる（FLIP：動く前と後の位置を測り、その差をアニメーションで埋める）
let drag = null;
const SLIDE = 'transform .16s ease';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const taskOrder = () => [...document.querySelectorAll('#tasks > .task')].map((li) => li.dataset.task);
document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest?.('[data-grip]');
  if (!grip || !state.editable || drag) return;
  e.preventDefault();
  document.activeElement?.blur?.(); // 書きかけのメモはここで保存される
  const li = grip.closest('.task');
  drag = { li, before: taskOrder().join(), startPageY: e.pageY, startTop: li.offsetTop, clientY: e.clientY, raf: 0 };
  li.classList.add('dragging');
  li.style.transition = 'none';
  grip.setPointerCapture(e.pointerId);
  drag.raf = requestAnimationFrame(dragFrame);
});
document.addEventListener('pointermove', (e) => { if (drag) drag.clientY = e.clientY; });

// 毎フレーム：画面の端ならスクロールし、カードを指の位置に置き、必要なら入れ替える
function dragFrame() {
  if (!drag) return;
  const { li } = drag;
  if (drag.clientY < 56) scrollBy(0, -10); else if (drag.clientY > innerHeight - 56) scrollBy(0, 10);
  const moved = drag.clientY + scrollY - drag.startPageY; // 掴んでから指が動いた量
  const center = drag.startTop + moved + li.offsetHeight / 2; // 掴んだカードの中心（ページ上）
  // 入る場所：ほかのカードのうち、中心が掴んだカードの中心より上にあるものの数
  const list = $('#tasks');
  const others = [...list.children].filter((x) => x !== li && x.classList.contains('task'));
  const index = others.filter((x) => x.offsetTop + x.offsetHeight / 2 < center).length;
  if (others[index] !== li.nextElementSibling || (index === others.length && list.lastElementChild !== li)) {
    const first = new Map(others.map((x) => [x, x.getBoundingClientRect().top]));
    if (index < others.length) list.insertBefore(li, others[index]); else list.appendChild(li);
    if (!reduceMotion()) {
      for (const x of others) {
        const dy = first.get(x) - x.getBoundingClientRect().top;
        if (!dy) continue;
        x.style.transition = 'none';
        x.style.transform = `translateY(${dy}px)`;
        x.getBoundingClientRect(); // ここで一度位置を確定させてから、滑らせる
        x.style.transition = SLIDE;
        x.style.transform = '';
      }
    }
  }
  li.style.transform = `translateY(${drag.startTop + moved - li.offsetTop}px)`;
  drag.raf = requestAnimationFrame(dragFrame);
}

async function endDrag() {
  if (!drag) return;
  const { li, before, raf } = drag;
  drag = null;
  cancelAnimationFrame(raf);
  // 指を離したら、収まる場所へ滑って戻る
  li.style.transition = reduceMotion() ? 'none' : SLIDE;
  li.style.transform = '';
  setTimeout(() => { li.classList.remove('dragging'); li.style.transition = ''; }, 170);
  const ids = taskOrder();
  if (ids.join() === before) return;
  ids.forEach((id, i) => { const t = findTask(id); if (t) t.sort = i; });
  const err = await send('POST', '/tasks/order', { ids }, '', { quiet: true });
  if (err) { alert(err); load(); }
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

// 残り時間は1分ごとに更新する
setInterval(() => { if (state.doc) renderTime(); }, 60000);

load();
