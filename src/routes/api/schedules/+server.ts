import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { setActiveScheduleForSession } from '$lib/server/auth';

function parseScheduleName(value: unknown): string {
	if (typeof value !== 'string') {
		throw error(400, 'A valid scheduleName is required');
	}
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > 200) {
		throw error(400, 'scheduleName must be between 1 and 200 characters');
	}
	return trimmed;
}

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const user = locals.user;
	if (!user) {
		throw error(401, 'Unauthorized');
	}

	const body = await request.json().catch(() => null);
	const scheduleName = parseScheduleName(body?.scheduleName);
	const pool = await GetPool();

	const managerAccessResult = await pool.request().input('userOid', user.id).query(
		`SELECT TOP (1) 1 AS HasManagerAccess
		 FROM dbo.ScheduleUsers su
		 INNER JOIN dbo.Roles r
			 ON r.RoleId = su.RoleId
		 INNER JOIN dbo.Schedules s
			 ON s.ScheduleId = su.ScheduleId
		 WHERE su.UserOid = @userOid
		   AND su.IsActive = 1
		   AND su.DeletedAt IS NULL
		   AND r.RoleName = 'Manager'
		   AND s.DeletedAt IS NULL;`
	);

	if (!managerAccessResult.recordset?.[0]?.HasManagerAccess) {
		throw error(403, 'Only managers can create schedules');
	}

	const createResult = await pool
		.request()
		.input('scheduleName', scheduleName)
		.input('userOid', user.id)
		.query(
			`DECLARE @ScheduleId int;
			 DECLARE @ManagerRoleId int;

			 SELECT TOP (1) @ManagerRoleId = RoleId
			 FROM dbo.Roles
			 WHERE RoleName = 'Manager';

			 IF @ManagerRoleId IS NULL
				 THROW 50000, 'Manager role not found', 1;

			 INSERT INTO dbo.Schedules (Name, CreatedBy)
			 VALUES (@scheduleName, @userOid);

			 SET @ScheduleId = SCOPE_IDENTITY();

			 INSERT INTO dbo.ScheduleUsers (ScheduleId, UserOid, RoleId, GrantedBy)
			 VALUES (@ScheduleId, @userOid, @ManagerRoleId, @userOid);

			 SELECT @ScheduleId AS ScheduleId;`
		);

	const scheduleId = createResult.recordset?.[0]?.ScheduleId;
	if (typeof scheduleId !== 'number') {
		throw error(500, 'Failed to create schedule');
	}

	await setActiveScheduleForSession(cookies, scheduleId);

	return json({ ok: true, scheduleId, activeScheduleId: scheduleId });
};
