import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { clearSession } from '$lib/server/auth';

function firstForwardedValue(value: string | null): string | null {
	if (!value) return null;
	const first = value.split(',')[0]?.trim();
	return first || null;
}

function resolveRequestOrigin(url: URL, headers: Headers): string {
	const forwardedProto = firstForwardedValue(headers.get('x-forwarded-proto'));
	const forwardedHost = firstForwardedValue(headers.get('x-forwarded-host'));
	const host = forwardedHost ?? firstForwardedValue(headers.get('host'));
	const proto = forwardedProto && /^(https?)$/i.test(forwardedProto) ? forwardedProto : null;
	if (proto && host) return `${proto}://${host}`;
	return url.origin;
}

function normalizePath(path: string | null | undefined): string {
	if (!path) return '';
	if (path === '/') return '/';
	const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
	return withLeadingSlash.replace(/\/+$/, '');
}

function buildSessionClearCookie(path: string): string {
	const secure = env.NODE_ENV === 'production';
	const parts = [
		'app_session=',
		`Path=${path}`,
		'HttpOnly',
		'SameSite=Lax',
		'Max-Age=0',
		'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
	];
	if (secure) parts.push('Secure');
	return parts.join('; ');
}

export const GET: RequestHandler = async (event) => {
	await clearSession(event.cookies);

	const defaultReturnTo = '/';
	const returnToParam = event.url.searchParams.get('returnTo')?.trim() ?? '';
	const returnToPath = returnToParam.startsWith('/') ? returnToParam : defaultReturnTo;
	const origin = resolveRequestOrigin(event.url, event.request.headers);
	const postLogoutRedirectUri = new URL(returnToPath, origin).toString();

	const tenantId = env.ENTRA_TENANT_ID?.trim();
	const location = tenantId
		? (() => {
				const logoutUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout`);
				logoutUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
				return logoutUrl.toString();
		  })()
		: returnToPath;

	const response = new Response(null, {
		status: 302,
		headers: {
			location
		}
	});

	// Clear session cookie for both root and base/prefix scoped deployments.
	const pathCandidates = new Set<string>(['/']);
	const basePath = normalizePath(process.env.KIT_BASE_PATH ?? '');
	if (basePath) pathCandidates.add(basePath);
	const proxyPrefix = normalizePath(firstForwardedValue(event.request.headers.get('x-forwarded-prefix')));
	if (proxyPrefix) pathCandidates.add(proxyPrefix);

	for (const path of pathCandidates) {
		response.headers.append('set-cookie', buildSessionClearCookie(path));
	}

	return response;
};
