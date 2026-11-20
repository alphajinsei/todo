// テーブル定義の唯一の正。変えたら npx drizzle-kit generate でマイグレーションを作る。
// 日付はすべて TIME_ZONE（Asia/Tokyo）でのローカル日付 'YYYY-MM-DD' の文字列。
//
// タスクは「タイトル・メモ・期限」だけ。細かく分けたければメモに書く（形式に縛られず、雑に使えるように）。
// 週の記録（records）は「その日に何をやったか」。人生の週のマスに、その週の分が並ぶ。
// タスクを完了にすると、記録が1行自動で入る（完了を取り消すと消える）。
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const TASK_STATUSES = ['open', 'done'] as const;
export const RECORD_KINDS = ['done', 'manual'] as const; // done：タスクの完了で自動で入ったもの

export const tasks = sqliteTable(
	'tasks',
	{
		id: text('id').primaryKey(),
		title: text('title').notNull(),
		memo: text('memo').notNull().default(''),
		deadline: text('deadline'), // 任意
		status: text('status', { enum: TASK_STATUSES }).notNull().default('open'),
		created: text('created').notNull(),
		done: text('done'),
		// 並び順（小さいほど上）。画面でドラッグして変える。新しいタスクは一番上に入る
		sort: integer('sort').notNull().default(0),
	},
	(t) => [index('tasks_status_idx').on(t.status)],
);

export const records = sqliteTable(
	'records',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		date: text('date').notNull(), // やった日。どの週のマスに入るかは、この日付と誕生日から決まる
		text: text('text').notNull(),
		kind: text('kind', { enum: RECORD_KINDS }).notNull().default('manual'),
		// タスクを消しても、やったことの記録は残す
		taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
		created: text('created').notNull(),
	},
	(t) => [index('records_date_idx').on(t.date)],
);
