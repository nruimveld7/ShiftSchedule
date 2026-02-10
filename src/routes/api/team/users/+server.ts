import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveScheduleId } from '$lib/server/auth';
import sql from 'mssql';
import type { Cookies } from '@sveltejs/kit';

type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';

type TeamUserRow = {
	UserOid: string;
	Name: string | null;
	Email: string | null;
	RoleName: ScheduleRole;
};

type ActorContext = {
	userOid: string;
	scheduleId: number;
	role: ScheduleRole;
};

type EffectiveRoleRow = {
	RoleName: ScheduleRole;
};

function assertRole(role: unknown): ScheduleRole {
	if (role === 'Member' || role === 'Maintainer' || role === 'Manager') {
		return role;
	}
	throw error(400, 'Invalid role');
}

function cleanOptionalText(value: unknown, maxLength: number): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
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
			   AND su.UserOid = @userOid
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
	if (role !== 'Manager' && role !== 'Maintainer') {
		throw error(403, 'Insufficient permissions');
	}

	return {
		pool,
		ctx: { userOid: localsUserOid, scheduleId, role } satisfies ActorContext
	};
}

async function getEffectiveRole(
	request: sql.Request,
	scheduleId: number,
	userOid: string
): Promise<ScheduleRole | null> {
	const result = await request
		.input('scheduleId', scheduleId)
		.input('targetUserOid', userOid)
		.query(
			`SELECT TOP (1) r.RoleName
			 FROM dbo.ScheduleUsers su
			 INNER JOIN dbo.Roles r
			   ON r.RoleId = su.RoleId
			 WHERE su.ScheduleId = @scheduleId
			   AND su.UserOid = @targetUserOid
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

	const row = result.recordset?.[0] as EffectiveRoleRow | undefined;
	return row?.RoleName ?? null;
}

async function countManagers(request: sql.Request, scheduleId: number): Promise<number> {
	const result = await request.input('scheduleId', scheduleId).query(
		`SELECT COUNT(DISTINCT su.UserOid) AS ManagerCount
		 FROM dbo.ScheduleUsers su
		 INNER JOIN dbo.Roles r
		   ON r.RoleId = su.RoleId
		 WHERE su.ScheduleId = @scheduleId
		   AND su.IsActive = 1
		   AND su.DeletedAt IS NULL
		   AND r.RoleName = 'Manager';`
	);
	return Number(result.recordset?.[0]?.ManagerCount ?? 0);
}

function assertCanManageRoleChanges(actor: ActorContext, currentRole: ScheduleRole | null, nextRole: ScheduleRole) {
	if (nextRole === 'Manager' && actor.role !== 'Manager') {
		throw error(403, 'Only Managers can assign Manager role');
	}
	if (currentRole === 'Manager' && actor.role !== 'Manager') {
		throw error(403, 'Only Managers can modify a Manager user');
	}
}

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, ctx } = await getActorContext(currentUser.id, cookies);

	const result = await pool
		.request()
		.input('scheduleId', ctx.scheduleId)
		.query(
			`WITH RankedUsers AS (
				SELECT
					su.UserOid,
					COALESCE(NULLIF(u.DisplayName, ''), NULLIF(u.FullName, ''), su.UserOid) AS Name,
					u.Email,
					r.RoleName,
					ROW_NUMBER() OVER (
						PARTITION BY su.UserOid
						ORDER BY
							CASE r.RoleName
								WHEN 'Manager' THEN 3
								WHEN 'Maintainer' THEN 2
								WHEN 'Member' THEN 1
								ELSE 0
							END DESC,
							su.GrantedAt DESC
					) AS RoleRank
				FROM dbo.ScheduleUsers su
				INNER JOIN dbo.Roles r
					ON r.RoleId = su.RoleId
				LEFT JOIN dbo.Users u
					ON u.UserOid = su.UserOid
				   AND u.DeletedAt IS NULL
				WHERE su.ScheduleId = @scheduleId
				  AND su.IsActive = 1
				  AND su.DeletedAt IS NULL
			)
			SELECT UserOid, Name, Email, RoleName
			FROM RankedUsers
			WHERE RoleRank = 1
			ORDER BY Name ASC, UserOid ASC;`
		);

	const users = (result.recordset as TeamUserRow[]).map((row) => ({
		userOid: row.UserOid,
		name: row.Name?.trim() || row.UserOid,
		email: row.Email?.trim() || '',
		role: row.RoleName
	}));

	return json({ users });
};

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, ctx } = await getActorContext(currentUser.id, cookies);
	const body = await request.json().catch(() => null);
	const targetUserOid = cleanOptionalText(body?.userOid, 64);
	const name = cleanOptionalText(body?.name, 200);
	const email = cleanOptionalText(body?.email, 320);
	const role = assertRole(body?.role);

	if (!targetUserOid) {
		throw error(400, 'A user must be selected');
	}

	assertCanManageRoleChanges(ctx, null, role);

	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const upsertUserRequest = new sql.Request(tx);
		await upsertUserRequest
			.input('userOid', targetUserOid)
			.input('fullName', name)
			.input('displayName', name)
			.input('email', email)
			.query(
				`MERGE dbo.Users AS target
				 USING (SELECT @userOid AS UserOid) AS source
				 ON target.UserOid = source.UserOid
				 WHEN MATCHED THEN
				   UPDATE SET FullName = COALESCE(@fullName, target.FullName),
							  DisplayName = COALESCE(@displayName, target.DisplayName),
							  Email = COALESCE(@email, target.Email),
							  IsActive = 1,
							  DeletedAt = NULL,
							  DeletedBy = NULL,
							  UpdatedAt = SYSUTCDATETIME()
				 WHEN NOT MATCHED THEN
				   INSERT (UserOid, FullName, DisplayName, Email)
				   VALUES (@userOid, @fullName, @displayName, @email);`
			);

		const roleIdResult = await new sql.Request(tx).input('roleName', role).query(
			`SELECT TOP (1) RoleId
			 FROM dbo.Roles
			 WHERE RoleName = @roleName;`
		);
		const roleId = roleIdResult.recordset?.[0]?.RoleId;
		if (!roleId) {
			throw error(500, 'Role configuration is missing');
		}

		await new sql.Request(tx)
			.input('scheduleId', ctx.scheduleId)
			.input('targetUserOid', targetUserOid)
			.input('actorUserOid', ctx.userOid)
			.query(
				`UPDATE dbo.ScheduleUsers
				 SET IsActive = 0,
					 DeletedAt = SYSUTCDATETIME(),
					 DeletedBy = @actorUserOid
				 WHERE ScheduleId = @scheduleId
				   AND UserOid = @targetUserOid
				   AND IsActive = 1
				   AND DeletedAt IS NULL;`
			);

		await new sql.Request(tx)
			.input('scheduleId', ctx.scheduleId)
			.input('targetUserOid', targetUserOid)
			.input('roleId', roleId)
			.input('actorUserOid', ctx.userOid)
			.query(
				`MERGE dbo.ScheduleUsers AS target
				 USING (SELECT @scheduleId AS ScheduleId, @targetUserOid AS UserOid, @roleId AS RoleId) AS source
				 ON target.ScheduleId = source.ScheduleId
				 AND target.UserOid = source.UserOid
				 AND target.RoleId = source.RoleId
				 WHEN MATCHED THEN
				   UPDATE SET IsActive = 1,
							  DeletedAt = NULL,
							  DeletedBy = NULL,
							  GrantedAt = SYSUTCDATETIME(),
							  GrantedBy = @actorUserOid
				 WHEN NOT MATCHED THEN
				   INSERT (ScheduleId, UserOid, RoleId, GrantedBy)
				   VALUES (@scheduleId, @targetUserOid, @roleId, @actorUserOid);`
			);

		await tx.commit();
		return json({ ok: true });
	} catch (e) {
		await tx.rollback();
		throw e;
	}
};

export const PATCH: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, ctx } = await getActorContext(currentUser.id, cookies);
	const body = await request.json().catch(() => null);
	const targetUserOid = cleanOptionalText(body?.userOid, 64);
	const nextRole = assertRole(body?.role);

	if (!targetUserOid) {
		throw error(400, 'Target user is required');
	}

	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const currentRole = await getEffectiveRole(new sql.Request(tx), ctx.scheduleId, targetUserOid);
		if (!currentRole) {
			throw error(404, 'User is not assigned to this schedule');
		}

		assertCanManageRoleChanges(ctx, currentRole, nextRole);

		if (currentRole === 'Manager' && nextRole !== 'Manager') {
			const managerCount = await countManagers(new sql.Request(tx), ctx.scheduleId);
			if (managerCount <= 1) {
				throw error(400, 'At least one Manager is required for the schedule');
			}
		}

		const roleIdResult = await new sql.Request(tx).input('roleName', nextRole).query(
			`SELECT TOP (1) RoleId
			 FROM dbo.Roles
			 WHERE RoleName = @roleName;`
		);
		const roleId = roleIdResult.recordset?.[0]?.RoleId;
		if (!roleId) {
			throw error(500, 'Role configuration is missing');
		}

		await new sql.Request(tx)
			.input('scheduleId', ctx.scheduleId)
			.input('targetUserOid', targetUserOid)
			.input('actorUserOid', ctx.userOid)
			.query(
				`UPDATE dbo.ScheduleUsers
				 SET IsActive = 0,
					 DeletedAt = SYSUTCDATETIME(),
					 DeletedBy = @actorUserOid
				 WHERE ScheduleId = @scheduleId
				   AND UserOid = @targetUserOid
				   AND IsActive = 1
				   AND DeletedAt IS NULL;`
			);

		await new sql.Request(tx)
			.input('scheduleId', ctx.scheduleId)
			.input('targetUserOid', targetUserOid)
			.input('roleId', roleId)
			.input('actorUserOid', ctx.userOid)
			.query(
				`MERGE dbo.ScheduleUsers AS target
				 USING (SELECT @scheduleId AS ScheduleId, @targetUserOid AS UserOid, @roleId AS RoleId) AS source
				 ON target.ScheduleId = source.ScheduleId
				 AND target.UserOid = source.UserOid
				 AND target.RoleId = source.RoleId
				 WHEN MATCHED THEN
				   UPDATE SET IsActive = 1,
							  DeletedAt = NULL,
							  DeletedBy = NULL,
							  GrantedAt = SYSUTCDATETIME(),
							  GrantedBy = @actorUserOid
				 WHEN NOT MATCHED THEN
				   INSERT (ScheduleId, UserOid, RoleId, GrantedBy)
				   VALUES (@scheduleId, @targetUserOid, @roleId, @actorUserOid);`
			);

		await tx.commit();
		return json({ ok: true });
	} catch (e) {
		await tx.rollback();
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, ctx } = await getActorContext(currentUser.id, cookies);
	const body = await request.json().catch(() => null);
	const targetUserOid = cleanOptionalText(body?.userOid, 64);
	if (!targetUserOid) {
		throw error(400, 'Target user is required');
	}

	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const currentRole = await getEffectiveRole(new sql.Request(tx), ctx.scheduleId, targetUserOid);
		if (!currentRole) {
			throw error(404, 'User is not assigned to this schedule');
		}

		if (currentRole === 'Manager' && ctx.role !== 'Manager') {
			throw error(403, 'Only Managers can remove a Manager user');
		}

		if (currentRole === 'Manager') {
			const managerCount = await countManagers(new sql.Request(tx), ctx.scheduleId);
			if (managerCount <= 1) {
				throw error(400, 'At least one Manager is required for the schedule');
			}
		}

		await new sql.Request(tx)
			.input('scheduleId', ctx.scheduleId)
			.input('targetUserOid', targetUserOid)
			.input('actorUserOid', ctx.userOid)
			.query(
				`UPDATE dbo.ScheduleUsers
				 SET IsActive = 0,
					 DeletedAt = SYSUTCDATETIME(),
					 DeletedBy = @actorUserOid
				 WHERE ScheduleId = @scheduleId
				   AND UserOid = @targetUserOid
				   AND IsActive = 1
				   AND DeletedAt IS NULL;`
			);

		await tx.commit();
		return json({ ok: true });
	} catch (e) {
		await tx.rollback();
		throw e;
	}
};
