import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';

function parseScheduleId(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw error(400, 'A valid scheduleId is required');
	}
	return value;
}

function parseIsActive(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw error(400, 'A valid isActive flag is required');
	}
	return value;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) {
		throw error(401, 'Unauthorized');
	}

	const body = await request.json().catch(() => null);
	const scheduleId = parseScheduleId(body?.scheduleId);
	const isActive = parseIsActive(body?.isActive);
	const pool = await GetPool();

	const managerAccessResult = await pool
		.request()
		.input('userOid', user.id)
		.input('scheduleId', scheduleId)
		.query(
			`SELECT TOP (1) 1 AS HasManagerAccess
			 FROM dbo.ScheduleUsers su
			 INNER JOIN dbo.Roles r
			   ON r.RoleId = su.RoleId
			 WHERE su.UserOid = @userOid
			   AND su.ScheduleId = @scheduleId
			   AND su.IsActive = 1
			   AND su.DeletedAt IS NULL
			   AND r.RoleName = 'Manager';`
		);

	if (!managerAccessResult.recordset?.[0]?.HasManagerAccess) {
		throw error(403, 'Only managers can change schedule state');
	}

	const updateResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('isActive', isActive ? 1 : 0)
		.input('userOid', user.id)
		.query(
			`UPDATE dbo.Schedules
			 SET IsActive = @isActive,
			     UpdatedAt = SYSUTCDATETIME(),
			     UpdatedBy = @userOid
			 WHERE ScheduleId = @scheduleId
			   AND DeletedAt IS NULL;

			 SELECT @@ROWCOUNT AS UpdatedRows;`
		);

	const updatedRows = Number(updateResult.recordset?.[0]?.UpdatedRows ?? 0);
	if (updatedRows < 1) {
		throw error(404, 'Schedule not found');
	}

	return json({ ok: true, scheduleId, isActive });
};
