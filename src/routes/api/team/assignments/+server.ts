import { error, json } from '@sveltejs/kit';
import type { Cookies, RequestHandler } from '@sveltejs/kit';
import { GetPool } from '$lib/server/db';
import { getActiveScheduleId } from '$lib/server/auth';
import sql from 'mssql';

type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';

type AssignmentRow = {
	DisplayOrder: number;
	UserOid: string;
	EmployeeTypeId: number;
	StartDate: Date | string;
	EndDate: Date | string | null;
	UserName: string | null;
	ShiftName: string | null;
};

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

function cleanRequiredInt(value: unknown, label: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw error(400, `${label} is invalid`);
	}
	return parsed;
}

function cleanOptionalSortOrder(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw error(400, 'Sort order must be a positive whole number');
	}
	return parsed;
}

function cleanDateOnly(value: unknown, label: string): string {
	if (typeof value !== 'string') {
		throw error(400, `${label} is required`);
	}
	const trimmed = value.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		throw error(400, `${label} must be in YYYY-MM-DD format`);
	}
	const parsed = new Date(`${trimmed}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) {
		throw error(400, `${label} is invalid`);
	}
	return trimmed;
}

function toDateOnly(value: Date | string | null): string | null {
	if (!value) return null;
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (typeof value === 'string') return value.slice(0, 10);
	return null;
}

function cleanAsOfDate(value: string | null): string | null {
	if (!value) return null;
	return cleanDateOnly(value, 'asOf');
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

	return { pool, scheduleId, actorOid: localsUserOid };
}

async function normalizeAssignmentOrder(tx: sql.Transaction, scheduleId: number) {
	await new sql.Request(tx)
		.input('scheduleId', scheduleId)
		.query(
			`WITH Ordered AS (
				SELECT
					ScheduleId,
					EmployeeTypeId,
					UserOid,
					StartDate,
					ROW_NUMBER() OVER (
						PARTITION BY ScheduleId, EmployeeTypeId
						ORDER BY DisplayOrder ASC, UserOid ASC, EmployeeTypeId ASC, StartDate ASC
					) AS NextDisplayOrder
				FROM dbo.ScheduleUserTypes
				WHERE ScheduleId = @scheduleId
				  AND IsActive = 1
				  AND DeletedAt IS NULL
			)
			UPDATE sut
			   SET DisplayOrder = o.NextDisplayOrder
			FROM dbo.ScheduleUserTypes sut
			INNER JOIN Ordered o
			  ON o.ScheduleId = sut.ScheduleId
			 AND o.EmployeeTypeId = sut.EmployeeTypeId
			 AND o.UserOid = sut.UserOid
			 AND o.StartDate = sut.StartDate
			WHERE sut.ScheduleId = @scheduleId
			  AND sut.IsActive = 1
			  AND sut.DeletedAt IS NULL
			  AND sut.DisplayOrder <> o.NextDisplayOrder;`
		);
}

async function ensureAssignmentReferencesValid(
	tx: sql.Transaction,
	scheduleId: number,
	userOid: string,
	employeeTypeId: number
) {
	const userResult = await new sql.Request(tx)
		.input('scheduleId', scheduleId)
		.input('userOid', userOid)
		.query(
			`SELECT TOP (1) 1 AS HasUser
			 FROM dbo.ScheduleUsers
			 WHERE ScheduleId = @scheduleId
			   AND UserOid = @userOid
			   AND IsActive = 1
			   AND DeletedAt IS NULL;`
		);
	if (!userResult.recordset?.[0]?.HasUser) {
		throw error(400, 'Selected user does not have access to this schedule');
	}

	const shiftResult = await new sql.Request(tx)
		.input('scheduleId', scheduleId)
		.input('employeeTypeId', employeeTypeId)
		.query(
			`SELECT TOP (1) 1 AS HasShift
			 FROM dbo.EmployeeTypes
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId
			   AND IsActive = 1
			   AND DeletedAt IS NULL;`
		);
	if (!shiftResult.recordset?.[0]?.HasShift) {
		throw error(400, 'Selected shift does not exist');
	}
}

async function applyEffectiveAssignmentChange(params: {
	tx: sql.Transaction;
	scheduleId: number;
	actorOid: string;
	userOid: string;
	employeeTypeId: number;
	startDate: string;
	sortOrder: number;
}) {
	const { tx, scheduleId, actorOid, userOid, employeeTypeId, startDate, sortOrder } = params;

	const timelineResult = await new sql.Request(tx)
		.input('scheduleId', scheduleId)
		.input('userOid', userOid)
		.input('effectiveStartDate', startDate)
		.query(
			`SELECT
				(SELECT TOP (1) StartDate
				 FROM dbo.ScheduleUserTypes
				 WHERE ScheduleId = @scheduleId
				   AND UserOid = @userOid
				   AND IsActive = 1
				   AND DeletedAt IS NULL
				   AND StartDate > @effectiveStartDate
				 ORDER BY StartDate ASC) AS NextStartDate,
				(SELECT TOP (1) StartDate
				 FROM dbo.ScheduleUserTypes
				 WHERE ScheduleId = @scheduleId
				   AND UserOid = @userOid
				   AND IsActive = 1
				   AND DeletedAt IS NULL
				   AND StartDate = @effectiveStartDate
				 ORDER BY EmployeeTypeId ASC) AS ExactStartDate,
				(SELECT TOP (1) StartDate
				 FROM dbo.ScheduleUserTypes
				 WHERE ScheduleId = @scheduleId
				   AND UserOid = @userOid
				   AND IsActive = 1
				   AND DeletedAt IS NULL
				   AND StartDate < @effectiveStartDate
				   AND (EndDate IS NULL OR EndDate >= @effectiveStartDate)
				 ORDER BY StartDate DESC, EmployeeTypeId ASC) AS ContainingStartDate;`
		);

	const nextStartDate = toDateOnly(timelineResult.recordset?.[0]?.NextStartDate);
	const exactStartDate = toDateOnly(timelineResult.recordset?.[0]?.ExactStartDate);
	const containingStartDate = toDateOnly(timelineResult.recordset?.[0]?.ContainingStartDate);
	const targetEndDate = nextStartDate
		? toDateOnly(new Date(new Date(`${nextStartDate}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000))
		: null;

	if (containingStartDate) {
		await new sql.Request(tx)
			.input('scheduleId', scheduleId)
			.input('userOid', userOid)
			.input('containingStartDate', containingStartDate)
			.input('effectiveStartDate', startDate)
			.input('actorOid', actorOid)
			.query(
				`UPDATE dbo.ScheduleUserTypes
				 SET EndDate = DATEADD(day, -1, @effectiveStartDate),
					 EndedAt = SYSUTCDATETIME(),
					 EndedBy = @actorOid
				 WHERE ScheduleId = @scheduleId
				   AND UserOid = @userOid
				   AND StartDate = @containingStartDate
				   AND IsActive = 1
				   AND DeletedAt IS NULL;`
			);
	}

	if (exactStartDate) {
		await new sql.Request(tx)
			.input('scheduleId', scheduleId)
			.input('userOid', userOid)
			.input('effectiveStartDate', startDate)
			.input('employeeTypeId', employeeTypeId)
			.input('sortOrder', sortOrder)
			.input('targetEndDate', targetEndDate)
			.input('actorOid', actorOid)
			.query(
				`UPDATE dbo.ScheduleUserTypes
				 SET EmployeeTypeId = @employeeTypeId,
					 DisplayOrder = @sortOrder,
					 EndDate = @targetEndDate,
					 EndedAt = CASE WHEN @targetEndDate IS NULL THEN NULL ELSE SYSUTCDATETIME() END,
					 EndedBy = CASE WHEN @targetEndDate IS NULL THEN NULL ELSE @actorOid END
				 WHERE ScheduleId = @scheduleId
				   AND UserOid = @userOid
				   AND StartDate = @effectiveStartDate
				   AND IsActive = 1
				   AND DeletedAt IS NULL;`
			);
		return;
	}

	await new sql.Request(tx)
		.input('scheduleId', scheduleId)
		.input('userOid', userOid)
		.input('employeeTypeId', employeeTypeId)
		.input('effectiveStartDate', startDate)
		.input('targetEndDate', targetEndDate)
		.input('sortOrder', sortOrder)
		.input('actorOid', actorOid)
		.query(
			`INSERT INTO dbo.ScheduleUserTypes (
				ScheduleId,
				UserOid,
				EmployeeTypeId,
				StartDate,
				EndDate,
				DisplayOrder,
				CreatedBy
			)
			VALUES (
				@scheduleId,
				@userOid,
				@employeeTypeId,
				@effectiveStartDate,
				@targetEndDate,
				@sortOrder,
				@actorOid
			);`
		);
}

export const GET: RequestHandler = async ({ locals, cookies, url }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId } = await getActorContext(currentUser.id, cookies);
	const asOf = cleanAsOfDate(url.searchParams.get('asOf'));
	const asOfDate = asOf ?? new Date().toISOString().slice(0, 10);

	const result = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('asOfDate', asOfDate)
		.query(
			`SELECT
				sut.DisplayOrder,
				sut.UserOid,
				sut.EmployeeTypeId,
				sut.StartDate,
				sut.EndDate,
				COALESCE(NULLIF(u.DisplayName, ''), NULLIF(u.FullName, ''), sut.UserOid) AS UserName,
				et.Name AS ShiftName
			 FROM dbo.ScheduleUserTypes sut
			 LEFT JOIN dbo.Users u
				ON u.UserOid = sut.UserOid
			   AND u.DeletedAt IS NULL
			 LEFT JOIN dbo.EmployeeTypes et
				ON et.ScheduleId = sut.ScheduleId
			   AND et.EmployeeTypeId = sut.EmployeeTypeId
			   AND et.IsActive = 1
			   AND et.DeletedAt IS NULL
			 WHERE sut.ScheduleId = @scheduleId
			   AND sut.IsActive = 1
			   AND sut.DeletedAt IS NULL
			   AND sut.StartDate <= @asOfDate
			   AND (sut.EndDate IS NULL OR sut.EndDate >= @asOfDate)
			 ORDER BY sut.DisplayOrder ASC, sut.UserOid ASC, sut.EmployeeTypeId ASC, sut.StartDate ASC;`
		);

	const assignments = (result.recordset as AssignmentRow[]).map((row) => {
		const startDate = toDateOnly(row.StartDate) ?? '';
		const assignmentId = `${row.UserOid}|${row.EmployeeTypeId}|${startDate}`;
		return {
			assignmentId,
			sortOrder: Number(row.DisplayOrder),
			userOid: row.UserOid,
			shiftEmployeeTypeId: Number(row.EmployeeTypeId),
			startDate,
			endDate: toDateOnly(row.EndDate),
			userName: row.UserName?.trim() || row.UserOid,
			shiftName: row.ShiftName?.trim() || 'Unknown shift'
		};
	});

	return json({ assignments });
};

async function upsertAssignment({
	locals,
	cookies,
	request
}: {
	locals: { user?: { id: string } | null };
	cookies: Cookies;
	request: Request;
}) {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId, actorOid } = await getActorContext(currentUser.id, cookies);
	const body = await request.json().catch(() => null);

	const userOid = cleanRequiredText(body?.userOid, 64, 'User');
	const employeeTypeId = cleanRequiredInt(body?.shiftEmployeeTypeId, 'Shift');
	const startDate = cleanDateOnly(body?.startDate, 'Effective start date');
	const requestedSortOrder = cleanOptionalSortOrder(body?.sortOrder ?? body?.displayOrder);

	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		await ensureAssignmentReferencesValid(tx, scheduleId, userOid, employeeTypeId);
		await normalizeAssignmentOrder(tx, scheduleId);

		const countResult = await new sql.Request(tx)
			.input('scheduleId', scheduleId)
			.input('employeeTypeId', employeeTypeId)
			.query(
			`SELECT COUNT(*) AS AssignmentCount
			 FROM dbo.ScheduleUserTypes
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId
			   AND IsActive = 1
			   AND DeletedAt IS NULL;`
			);
		const assignmentCount = Number(countResult.recordset?.[0]?.AssignmentCount ?? 0);
		const maxSortOrder = assignmentCount + 1;
		const targetSortOrder = requestedSortOrder ?? maxSortOrder;
		if (targetSortOrder < 1 || targetSortOrder > maxSortOrder) {
			throw error(400, `Sort order must be between 1 and ${maxSortOrder}`);
		}

		await new sql.Request(tx)
			.input('scheduleId', scheduleId)
			.input('employeeTypeId', employeeTypeId)
			.input('targetSortOrder', targetSortOrder)
			.query(
				`UPDATE dbo.ScheduleUserTypes
				 SET DisplayOrder = DisplayOrder + 1
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId
				   AND IsActive = 1
				   AND DeletedAt IS NULL
				   AND DisplayOrder >= @targetSortOrder;`
			);

		await applyEffectiveAssignmentChange({
			tx,
			scheduleId,
			actorOid,
			userOid,
			employeeTypeId,
			startDate,
			sortOrder: targetSortOrder
		});

		await tx.commit();
	} catch (e) {
		await tx.rollback();
		throw e;
	}

	return json({ success: true });
}

export const POST: RequestHandler = async ({ locals, cookies, request }) =>
	upsertAssignment({ locals, cookies, request });

export const PATCH: RequestHandler = async ({ locals, cookies, request }) =>
	upsertAssignment({ locals, cookies, request });
