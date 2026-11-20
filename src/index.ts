// todo の API（Hono）。
//
//   GET  /api/health          死活確認
//   GET  /api/data            誰でも読める（タスクと週の記録の全体）
//   GET  /admin               編集画面（public/index.html を返す。Access でログイン）
//   *    /admin/api/...       書き込み。Access でログインした本人だけ（JWT も検証する）
//
// 返すのはいつも全体（GET /api/data と同じ形）。画面はそれで描き直す。
import { Hono, type Context } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { records, tasks } from './db/schema';
import { requireAccess } from './access';
import { RuleError, date, newId, optionalDate, str, today } from './rules';

type App = { Bindings: Env };
type Body = Record<string, unknown>;

const app = new Hono<App>();

app.onError((err, c) => {
	if (err instanceof RuleError) return c.json({ error: err.message }, err.status);
	console.error(err);
	return c.json({ error: 'サーバーでエラーが起きました' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));
app.get('/api/data', async (c) => c.json(await loadDoc(c.env)));

// 編集画面は公開画面と同じ HTML。画面は URL が /admin かどうかで編集モードになる
const page = (c: Context<App>) => c.env.ASSETS.fetch(new Request(new URL('/', c.req.url)));
app.get('/admin', page);
app.get('/admin/', page);

const admin = new Hono<App>();
admin.use(requireAccess);

// ================= タスク =================

admin.post('/tasks', async (c) => {
	const b = await readBody(c);
	// 一番上に入れる（いまの一番小さい sort より1つ小さく）
	const top = await c.env.DB.prepare(`SELECT COALESCE(MIN(sort), 0) - 1 AS s FROM tasks WHERE status = 'open'`).first<{ s: number }>();
	await drizzle(c.env.DB)
		.insert(tasks)
		.values({
			id: newId(),
			title: str(b, 'title', 'タスク', { required: true }),
			memo: str(b, 'memo', 'メモ'),
			deadline: optionalDate(b, 'deadline', '期限'),
			created: today(c.env.TIME_ZONE),
			sort: top?.s ?? 0,
		});
	return c.json(await loadDoc(c.env), 201);
});

// 並べ替え。上から順の id の並びを受け取り、その順に sort を振り直す
admin.post('/tasks/order', async (c) => {
	const b = await readBody(c);
	const ids = b.ids;
	if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || !ids.every((x) => typeof x === 'string'))
		throw new RuleError('並び順（ids）は id の配列で送ってください');
	if (new Set(ids).size !== ids.length) throw new RuleError('同じ id が重なっています');
	const DB = c.env.DB;
	await DB.batch(ids.map((id, i) => DB.prepare('UPDATE tasks SET sort = ?2 WHERE id = ?1').bind(id, i)));
	return c.json(await loadDoc(c.env));
});

// 送られてきた項目だけ変える（メモだけ、期限だけ、など）。期限を空にすると期限なし
admin.patch('/tasks/:id', async (c) => {
	const id = c.req.param('id');
	const b = await readBody(c);
	const set: Partial<typeof tasks.$inferInsert> = {};
	if ('title' in b) set.title = str(b, 'title', 'タスク', { required: true });
	if ('memo' in b) set.memo = str(b, 'memo', 'メモ', { max: 20000 });
	if ('deadline' in b) set.deadline = optionalDate(b, 'deadline', '期限');
	if (!Object.keys(set).length) throw new RuleError('変える項目がありません');
	const r = await drizzle(c.env.DB).update(tasks).set(set).where(eq(tasks.id, id)).returning({ id: tasks.id });
	if (!r.length) throw new RuleError('見つかりません', 404);
	return c.json(await loadDoc(c.env));
});

admin.delete('/tasks/:id', async (c) => {
	const r = await drizzle(c.env.DB).delete(tasks).where(eq(tasks.id, c.req.param('id'))).returning({ id: tasks.id });
	if (!r.length) throw new RuleError('見つかりません', 404);
	return c.json(await loadDoc(c.env));
});

// 完了。その日の記録に1行入る
admin.post('/tasks/:id/done', async (c) => {
	const id = c.req.param('id');
	const t = today(c.env.TIME_ZONE);
	const DB = c.env.DB;
	const [upd] = await DB.batch([
		DB.prepare(`UPDATE tasks SET status = 'done', done = ?2 WHERE id = ?1 AND status = 'open'`).bind(id, t),
		DB.prepare(
			`INSERT INTO records (date, text, kind, task_id, created)
			 SELECT ?2, title, 'done', id, ?2 FROM tasks WHERE id = ?1 AND status = 'done' AND done = ?2
			   AND NOT EXISTS (SELECT 1 FROM records WHERE task_id = ?1 AND kind = 'done')`,
		).bind(id, t),
	]);
	if (!upd.meta.changes) await notFoundOr(c, id, 'もう完了しています');
	return c.json(await loadDoc(c.env));
});

// 完了の取り消し。自動で入った記録も消す（手で書いた記録は残す）
admin.post('/tasks/:id/reopen', async (c) => {
	const id = c.req.param('id');
	const DB = c.env.DB;
	const [upd] = await DB.batch([
		DB.prepare(`UPDATE tasks SET status = 'open', done = NULL WHERE id = ?1 AND status = 'done'`).bind(id),
		DB.prepare(`DELETE FROM records WHERE task_id = ?1 AND kind = 'done' AND (SELECT status FROM tasks WHERE id = ?1) = 'open'`).bind(id),
	]);
	if (!upd.meta.changes) await notFoundOr(c, id, 'まだ完了していません');
	return c.json(await loadDoc(c.env));
});

// ================= 週の記録 =================

admin.post('/records', async (c) => {
	const b = await readBody(c);
	const t = today(c.env.TIME_ZONE);
	const d = date(b, 'date', '日付');
	if (d > t) throw new RuleError('未来の日付には記録できません');
	const taskId = str(b, 'taskId', 'タスク') || null;
	await drizzle(c.env.DB)
		.insert(records)
		.values({ date: d, text: str(b, 'text', 'やったこと', { required: true }), kind: 'manual', taskId, created: t });
	return c.json(await loadDoc(c.env), 201);
});

admin.patch('/records/:id', async (c) => {
	const id = Number(c.req.param('id'));
	const b = await readBody(c);
	const set: Partial<typeof records.$inferInsert> = {};
	if ('text' in b) set.text = str(b, 'text', 'やったこと', { required: true });
	if ('date' in b) {
		set.date = date(b, 'date', '日付');
		if (set.date > today(c.env.TIME_ZONE)) throw new RuleError('未来の日付には記録できません');
	}
	if (!Object.keys(set).length) throw new RuleError('変える項目がありません');
	const r = await drizzle(c.env.DB).update(records).set(set).where(eq(records.id, id)).returning({ id: records.id });
	if (!r.length) throw new RuleError('見つかりません', 404);
	return c.json(await loadDoc(c.env));
});

admin.delete('/records/:id', async (c) => {
	const id = Number(c.req.param('id'));
	const r = await drizzle(c.env.DB).delete(records).where(eq(records.id, id)).returning({ id: records.id });
	if (!r.length) throw new RuleError('見つかりません', 404);
	return c.json(await loadDoc(c.env));
});

app.route('/admin/api', admin);

export default app;

// ================= 部品 =================
async function loadDoc(env: Env) {
	const db = drizzle(env.DB);
	const [ts, rs] = await db.batch([
		db.select().from(tasks).orderBy(asc(tasks.created), asc(tasks.id)),
		db.select().from(records).orderBy(asc(records.date), asc(records.id)),
	]);
	return {
		owner: { birthday: env.OWNER_BIRTHDAY, lifespanYears: Number(env.LIFESPAN_YEARS) },
		tasks: ts.map(withoutNulls),
		records: rs.map(withoutNulls),
	};
}

const withoutNulls = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as Partial<T>;

async function readBody(c: Context<App>): Promise<Body> {
	let b: unknown;
	try {
		b = await c.req.json();
	} catch {
		throw new RuleError('JSON が読めません');
	}
	if (typeof b !== 'object' || b === null || Array.isArray(b)) throw new RuleError('JSON のオブジェクトを送ってください');
	return b as Body;
}

async function notFoundOr(c: Context<App>, id: string, message: string): Promise<never> {
	const [t] = await drizzle(c.env.DB).select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, id)));
	if (!t) throw new RuleError('見つかりません', 404);
	throw new RuleError(message, 409);
}
