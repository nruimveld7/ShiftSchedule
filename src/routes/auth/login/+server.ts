import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { getAuthorizeUrl, setAuthState } from '$lib/server/auth';

export const GET: RequestHandler = async ({ cookies, url }) => {
    const { authorizeUrl, state, nonce, codeVerifier } = await getAuthorizeUrl(url);

    setAuthState(cookies, { state, nonce, codeVerifier });

    throw redirect(302, authorizeUrl);
};
