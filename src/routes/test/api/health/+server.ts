import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    let body: unknown = {};
    try {
        body = await request.json();
    } catch {
        body = {};
    }
    if(body && typeof body === 'object') {
        if('value' in body) {
            const value = Number(body.value);
            const randomValue = Math.floor(Math.random() * value);
            return json({value: randomValue});
        }
    }
	return json({ value: Number(15) });
};