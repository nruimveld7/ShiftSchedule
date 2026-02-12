import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { GetPool } from '$lib/server/db';
import { getAccessState } from '$lib/server/access';
import { setActiveScheduleForSession } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		throw redirect(302, '/auth/login');
	}
	const access = await getAccessState(user.id);
	if (!access.isBootstrap) {
		throw redirect(302, '/');
	}
	return { user };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) {
			throw redirect(302, '/auth/login');
		}
		const access = await getAccessState(user.id);
		if (!access.isBootstrap) {
			throw redirect(302, '/');
		}

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) {
			throw error(400, 'Schedule name is required.');
		}

		const pool = await GetPool();
		const requestDb = pool.request();
		requestDb.input('name', name);
		requestDb.input('userOid', user.id);

		const result = await requestDb.query(`
			DECLARE @ScheduleId int;
			DECLARE @ManagerRoleId int;

			INSERT INTO dbo.Schedules (Name, Description, CreatedBy)
			VALUES (@name, NULL, @userOid);

			SET @ScheduleId = SCOPE_IDENTITY();

			SELECT TOP (1) @ManagerRoleId = RoleId FROM dbo.Roles WHERE RoleName = 'Manager';

			IF @ManagerRoleId IS NULL
			BEGIN
				RAISERROR ('Manager role not found.', 16, 1);
				RETURN;
			END

			INSERT INTO dbo.ScheduleUsers (ScheduleId, UserOid, RoleId, GrantedBy)
			VALUES (@ScheduleId, @userOid, @ManagerRoleId, @userOid);

			UPDATE dbo.Users
			SET DefaultScheduleId = CASE WHEN DefaultScheduleId IS NULL THEN @ScheduleId ELSE DefaultScheduleId END,
				UpdatedAt = SYSUTCDATETIME()
			WHERE UserOid = @userOid
			  AND DeletedAt IS NULL;

			SELECT @ScheduleId AS ScheduleId;
		`);

		const scheduleId = result.recordset?.[0]?.ScheduleId;
		if (scheduleId) {
			await setActiveScheduleForSession(locals.cookies, scheduleId);
		}

		throw redirect(303, '/');
	}
};
