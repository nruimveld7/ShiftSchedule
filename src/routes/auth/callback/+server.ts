import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { finishLogin } from '$lib/server/auth';

export const GET: RequestHandler = async (event) => {
    const session = await finishLogin(event);
    // set your local session cookie here (inside finishLogin or here)
    throw redirect(302, '/');
};
