// 見本の JSON（seed/*.json）を、D1 に流す SQL にして標準出力に出す。手元の見た目の確認用。
//   node scripts/seed.mjs seed/sample.json > seed/sample.sql
//   npx wrangler d1 execute DB --local --file seed/sample.sql
// 既存の行はすべて消してから入れる。本番（--remote）には流さないこと。
//
// 形式：{ asOf?, tasks: [{ id, title, memo?, deadline?, status?, created, done? }], records?: [{ date, text, task? }] }
// - asOf があれば、その日が今日になるよう、すべての日付をずらす（期限切れなどの見え方を保つため）
// - 完了のタスクには、完了の日の記録を自動で足す（アプリで完了にしたときと同じ）
// - 古い形式（why・output・nextAction などを持つタスク）も読める。それらはメモにまとめ、やめたものは入れない
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
	console.error('usage: node scripts/seed.mjs <file.json>');
	process.exit(1);
}
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const shiftDays = doc.asOf ? (Date.parse(todayStr) - Date.parse(doc.asOf)) / DAY : 0;
const d = (s) => (s ? new Date(Date.parse(s) + shiftDays * DAY).toISOString().slice(0, 10) : s);

const q = (v) => (v === undefined || v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
const insert = (table, row) => `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`;

const out = ['DELETE FROM records;', 'DELETE FROM tasks;'];
for (const t of doc.tasks) {
	if (t.status === 'dropped') continue;
	const done = t.status === 'done';
	const memo = [
		t.memo,
		t.why && `なぜ：${t.why}`,
		t.output && `成果物：${t.output}`,
		t.nextAction && !done && `次の一手：${t.nextAction}`,
	]
		.filter(Boolean)
		.join('\n');
	out.push(
		insert('tasks', {
			id: t.id,
			title: t.title,
			memo,
			deadline: done ? null : d(t.deadline),
			status: done ? 'done' : 'open',
			created: d(t.created),
			done: done ? d(t.done) : null,
		}),
	);
	if (done) out.push(insert('records', { date: d(t.done), text: t.title, kind: 'done', task_id: t.id, created: d(t.done) }));
}
for (const r of doc.records || []) {
	out.push(insert('records', { date: d(r.date), text: r.text, kind: 'manual', task_id: r.task ?? null, created: d(r.date) }));
}
console.log(out.join('\n'));
