// 書き込みの API の前に置く。Cloudflare Access が付けた JWT（Cf-Access-Jwt-Assertion）を検証する。
// Access がパスで守っていても、守る範囲の設定を間違えたときに Worker まで素通りしないよう、ここでも確かめる。
import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export const requireAccess = createMiddleware<{ Bindings: Env }>(async (c, next) => {
	if (c.env.DEV_SKIP_ACCESS === 'true') return next(); // 手元の wrangler dev だけ（.dev.vars）

	const team = c.env.ACCESS_TEAM_DOMAIN;
	const aud: string = c.env.ACCESS_AUD;
	const token = c.req.header('cf-access-jwt-assertion');
	if (!aud || !token) return c.json({ error: 'ログインが必要です' }, 403);

	jwks ??= createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
	try {
		await jwtVerify(token, jwks, { issuer: team, audience: aud });
	} catch {
		return c.json({ error: 'ログインが必要です' }, 403);
	}
	await next();
});
