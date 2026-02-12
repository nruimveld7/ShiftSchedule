import { GetPool } from '$lib/server/db';

export type AccessState = {
	hasSchedules: boolean;
	hasScheduleUsers: boolean;
	hasScheduleAccess: boolean;
	isBootstrap: boolean;
	hasAccess: boolean;
};

export async function getAccessState(userOid: string): Promise<AccessState> {
	const pool = await GetPool();
	const result = await pool
		.request()
		.input('userOid', userOid)
		.query(
			`
			DECLARE @hasBootstrap bit = 0;
			DECLARE @hasScheduleAccess bit = 0;
			DECLARE @hasSchedules bit = 0;
			DECLARE @hasScheduleUsers bit = 0;

			IF OBJECT_ID('dbo.BootstrapManagers', 'U') IS NOT NULL
			BEGIN
				IF EXISTS (
					SELECT 1 FROM dbo.BootstrapManagers
					WHERE UserOid = @userOid AND DeletedAt IS NULL AND IsActive = 1
				)
				BEGIN
					SET @hasBootstrap = 1;
				END
			END

			IF OBJECT_ID('dbo.ScheduleUsers', 'U') IS NOT NULL
			BEGIN
				IF EXISTS (
					SELECT 1 FROM dbo.ScheduleUsers
					WHERE DeletedAt IS NULL AND IsActive = 1
				)
				BEGIN
					SET @hasScheduleUsers = 1;
				END

				IF EXISTS (
					SELECT 1
					FROM dbo.ScheduleUsers su
					INNER JOIN dbo.Schedules s
						ON s.ScheduleId = su.ScheduleId
					LEFT JOIN dbo.Roles r
						ON r.RoleId = su.RoleId
					WHERE su.UserOid = @userOid
					  AND su.DeletedAt IS NULL
					  AND su.IsActive = 1
					  AND s.DeletedAt IS NULL
					  AND (s.IsActive = 1 OR r.RoleName = 'Manager')
				)
				BEGIN
					SET @hasScheduleAccess = 1;
				END
			END

			IF OBJECT_ID('dbo.Schedules', 'U') IS NOT NULL
			BEGIN
				IF EXISTS (SELECT 1 FROM dbo.Schedules WHERE DeletedAt IS NULL)
				BEGIN
					SET @hasSchedules = 1;
				END
			END

			SELECT
				@hasBootstrap AS HasBootstrap,
				@hasScheduleAccess AS HasScheduleAccess,
				@hasSchedules AS HasSchedules,
				@hasScheduleUsers AS HasScheduleUsers;
		`
		);

	const row = result.recordset?.[0];
	const hasSchedules = Boolean(row?.HasSchedules);
	const hasScheduleAccess = Boolean(row?.HasScheduleAccess);
	const isBootstrap = Boolean(row?.HasBootstrap);
	const hasScheduleUsers = Boolean(row?.HasScheduleUsers);
	const hasAccess = isBootstrap || hasScheduleAccess;
	return { hasSchedules, hasScheduleUsers, hasScheduleAccess, isBootstrap, hasAccess };
}
