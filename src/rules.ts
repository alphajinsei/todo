// 入力の検証と日付。
export class RuleError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 409 = 400,
	) {
		super(message);
	}
}

type Body = Record<string, unknown>;

export function str(body: Body, key: string, label: string, { required = false, max = 2000 } = {}): string {
	const v = body[key];
	if (v !== undefined && v !== null && typeof v !== 'string') throw new RuleError(`「${label}」が文字列ではありません`);
	const s = (v ?? '').trim();
	if (required && !s) throw new RuleError(`「${label}」を入れてください`);
	if (s.length > max) throw new RuleError(`「${label}」が長すぎます`);
	return s;
}

export function date(body: Body, key: string, label: string): string {
	const s = str(body, key, label, { required: true });
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new RuleError(`「${label}」が日付ではありません`);
	return s;
}

// 任意の日付。空なら null
export function optionalDate(body: Body, key: string, label: string): string | null {
	return str(body, key, label) ? date(body, key, label) : null;
}

// TIME_ZONE での今日（'YYYY-MM-DD'）
export function today(timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
	const get = (t: string) => parts.find((p) => p.type === t)!.value;
	return `${get('year')}-${get('month')}-${get('day')}`;
}

export const newId = () => Date.now().toString(36) + crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4);
