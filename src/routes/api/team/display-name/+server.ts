import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Cookies } from '@sveltejs/kit';
import { GetPool } from '$lib/server/db';
import { getActiveScheduleId } from '$lib/server/auth';
import sql from 'mssql';

type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';

function normalizeOid(value: string): string {
	return value.trim().toLowerCase();
}

function cleanRequiredText(value: unknown, maxLength: number, label: string): string {
	if (typeof value !== 'string') {
		throw error(400, `${label} is required`);
	}
	const trimmed = value.trim();
	if (!trimmed) {
		throw error(400, `${label} is required`);
	}
	return trimmed.slice(0, maxLength);
}

async function getActorContext(localsUserOid: string, cookies: Cookies) {
	const scheduleId = await getActiveScheduleId(cookies);
	if (!scheduleId) {
		throw error(400, 'No active schedule selected');
	}

	const pool = await GetPool();
	const accessResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('userOid', localsUserOid)
		.query(
			`SELECT TOP (1) r.RoleName
			 FROM dbo.ScheduleUsers su
			 INNER JOIN dbo.Roles r
			   ON r.RoleId = su.RoleId
			 WHERE su.ScheduleId = @scheduleId
			   AND UPPER(LTRIM(RTRIM(su.UserOid))) = UPPER(LTRIM(RTRIM(@userOid)))
			   AND su.IsActive = 1
			   AND su.DeletedAt IS NULL
			 ORDER BY
			   CASE r.RoleName
				 WHEN 'Manager' THEN 3
				 WHEN 'Maintainer' THEN 2
				 WHEN 'Member' THEN 1
				 ELSE 0
			   END DESC;`
		);

	const role = accessResult.recordset?.[0]?.RoleName as ScheduleRole | undefined;
	if (role !== 'Manager' && role !== 'Maintainer' && role !== 'Member') {
		throw error(403, 'Insufficient permissions');
	}

	return { pool, scheduleId, role };
}

async function resolveTargetUserOidInSchedule(
	pool: sql.ConnectionPool,
	scheduleId: number,
	targetUserOid: string
) {
	const targetResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('targetUserOid', targetUserOid)
		.query(
			`SELECT TOP (1) su.UserOid
			 FROM dbo.ScheduleUsers su
			 WHERE su.ScheduleId = @scheduleId
			   AND UPPER(LTRIM(RTRIM(su.UserOid))) = UPPER(LTRIM(RTRIM(@targetUserOid)))
			   AND su.IsActive = 1
			   AND su.DeletedAt IS NULL
			 ORDER BY su.UserOid ASC;`
		);

	const resolvedUserOid = (targetResult.recordset?.[0]?.UserOid as string | undefined)?.trim();
	if (!resolvedUserOid) {
		throw error(404, 'User is not assigned to the active schedule');
	}
	return resolvedUserOid;
}

export const PATCH: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const body = await request.json().catch(() => null);
	const targetUserOid = cleanRequiredText(body?.userOid, 64, 'User');
	const displayName = cleanRequiredText(body?.displayName, 200, 'Display name');

	const { pool, scheduleId, role } = await getActorContext(currentUser.id, cookies);
	void role;
	if (normalizeOid(targetUserOid) !== normalizeOid(currentUser.id)) {
		throw error(403, 'Users can only change their own display name');
	}
	const resolvedTargetUserOid = await resolveTargetUserOidInSchedule(pool, scheduleId, targetUserOid);
	if (normalizeOid(resolvedTargetUserOid) !== normalizeOid(currentUser.id)) {
		throw error(403, 'Users can only change their own display name');
	}

	await pool
		.request()
		.input('targetUserOid', resolvedTargetUserOid)
		.input('displayName', displayName)
		.query(
			`MERGE dbo.Users AS target
			 USING (SELECT @targetUserOid AS UserOid) AS source
			 ON target.UserOid = source.UserOid
			 WHEN MATCHED THEN
			   UPDATE SET DisplayName = @displayName,
						  IsActive = 1,
						  DeletedAt = NULL,
						  DeletedBy = NULL,
						  UpdatedAt = SYSUTCDATETIME()
			 WHEN NOT MATCHED THEN
			   INSERT (UserOid, DisplayName, FullName)
			   VALUES (@targetUserOid, @displayName, @displayName);`
		);

	return json({ ok: true, userOid: resolvedTargetUserOid, displayName });
};
