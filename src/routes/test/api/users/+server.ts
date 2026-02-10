import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchTenantUsers } from '$lib/server/graph';
import { getSessionAccessToken } from '$lib/server/auth';

export const GET: RequestHandler = async (event) => {
	const token = await getSessionAccessToken(event);
	const q = event.url.searchParams.get('q')?.trim() ?? '';

	if (q.length > 0) {
		const users = await searchTenantUsers(token, q);
		return json({ users });
	}

	return json({ users: [] });
};
