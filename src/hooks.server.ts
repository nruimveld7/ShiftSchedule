import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { readSession } from '$lib/server/auth';
import { getAccessState } from '$lib/server/access';

const PUBLIC_PATHS = ['/auth/login', '/auth/callback', '/favicon.ico'];
const UNAUTHORIZED_PATH = '/unauthorized';
const SETUP_PATH = '/setup';

export const handle: Handle = async ({ event, resolve }) => {
    const { pathname } = event.url;

    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
        return resolve(event);
    }

    const session = await readSession(event);
    if (!session) {
        throw redirect(302, '/auth/login');
    }

    const access = await getAccessState(session.user.id);
    if (access.isBootstrap && !access.hasScheduleAccess && pathname !== SETUP_PATH) {
        throw redirect(302, SETUP_PATH);
    }
    if (!access.hasAccess && pathname !== UNAUTHORIZED_PATH) {
        throw redirect(302, UNAUTHORIZED_PATH);
    }
    if (access.hasAccess && pathname === UNAUTHORIZED_PATH) {
        throw redirect(302, '/');
    }
    if (pathname === SETUP_PATH && !access.isBootstrap) {
        throw redirect(302, '/');
    }

    event.locals.user = session.user;
    return resolve(event);
};
