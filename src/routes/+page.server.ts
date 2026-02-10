import type { PageServerLoad } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveScheduleId, setActiveScheduleForSession } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const user = locals.user;
	if (!user) return { schedule: null, userRole: null };

	let scheduleId = await getActiveScheduleId(cookies);
	if (!scheduleId) {
		const pool = await GetPool();
		const result = await pool
			.request()
			.input('userOid', user.id)
			.query(
				`SELECT TOP (1) ScheduleId
				 FROM dbo.ScheduleUsers
				 WHERE UserOid = @userOid AND DeletedAt IS NULL AND IsActive = 1
				 ORDER BY ScheduleId;`
			);
		scheduleId = result.recordset?.[0]?.ScheduleId ?? null;
		if (scheduleId) {
			await setActiveScheduleForSession(cookies, scheduleId);
		}
	}

	if (!scheduleId) return { schedule: null, userRole: null };

	const pool = await GetPool();
	const scheduleResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.query(
			`SELECT TOP (1) ScheduleId, Name
			 FROM dbo.Schedules
			 WHERE ScheduleId = @scheduleId AND DeletedAt IS NULL;`
		);

	const roleResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('userOid', user.id)
		.query(
			`SELECT TOP (1) r.RoleName
			 FROM dbo.ScheduleUsers su
			 INNER JOIN dbo.Roles r
				 ON r.RoleId = su.RoleId
			 WHERE su.ScheduleId = @scheduleId
			   AND su.UserOid = @userOid
			   AND su.DeletedAt IS NULL
			   AND su.IsActive = 1
			 ORDER BY
			   CASE r.RoleName
				 WHEN 'Manager' THEN 3
				 WHEN 'Maintainer' THEN 2
				 WHEN 'Member' THEN 1
				 ELSE 0
			   END DESC;`
		);

	return {
		schedule: scheduleResult.recordset?.[0] ?? null,
		userRole: roleResult.recordset?.[0]?.RoleName ?? null
	};
};
