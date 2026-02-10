import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';

export const GET: RequestHandler = async ({  }) => {
    const pool = await GetPool();
    const result = await pool.request().query('SELECT TOP (1) Value FROM dbo.SingleCell;');
    const value = result.recordset[0]?.Value ?? 0;
    return json({ value: Number(value) });
}

export const POST: RequestHandler = async ({ request }) => {
    const pool = await GetPool();
    let body = await request.json();
    const value = Number(body.value);
    const result = await pool
        .request()
        .input('value', value)
        .query('UPDATE dbo.SingleCell Set Value = @value OUTPUT inserted.Value;');
    const dbValue = result.recordset[0]?.Value ?? 0;
    return json({ value: Number(dbValue) });
};