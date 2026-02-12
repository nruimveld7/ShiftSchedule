import { error, json } from '@sveltejs/kit';
import type { Cookies, RequestHandler } from '@sveltejs/kit';
import { GetPool } from '$lib/server/db';
import { getActiveScheduleId } from '$lib/server/auth';
import sql from 'mssql';

type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';

type ShiftRow = {
	EmployeeTypeId: number;
	DisplayOrder: number;
	Name: string;
	PatternId: number | null;
	PatternName: string | null;
	StartDate: Date | string;
};

async function employeeTypesHasStartDate(
	pool: Awaited<ReturnType<typeof GetPool>>
): Promise<boolean> {
	const columnResult = await pool.request().query(
		`SELECT TOP (1) 1 AS HasStartDate
		 FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_SCHEMA = 'dbo'
		   AND TABLE_NAME = 'EmployeeTypes'
		   AND COLUMN_NAME = 'StartDate';`
	);
	return Number(columnResult.recordset?.[0]?.HasStartDate ?? 0) === 1;
}

async function employeeTypeVersionsEnabled(
	pool: Awaited<ReturnType<typeof GetPool>>
): Promise<boolean> {
	const result = await pool.request().query(
		`SELECT TOP (1) 1 AS HasTable
		 FROM INFORMATION_SCHEMA.TABLES
		 WHERE TABLE_SCHEMA = 'dbo'
		   AND TABLE_NAME = 'EmployeeTypeVersions';`
	);
	return Number(result.recordset?.[0]?.HasTable ?? 0) === 1;
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

function cleanOptionalPatternId(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const patternId = Number(value);
	if (!Number.isInteger(patternId) || patternId <= 0) {
		throw error(400, 'Pattern is invalid');
	}
	return patternId;
}

function cleanStartDate(value: unknown): string {
	if (typeof value !== 'string') {
		throw error(400, 'Start date is required');
	}
	const trimmed = value.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		throw error(400, 'Start date must be in YYYY-MM-DD format');
	}
	const parsed = new Date(`${trimmed}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) {
		throw error(400, 'Start date is invalid');
	}
	return trimmed;
}

function cleanSortOrder(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw error(400, 'Sort order must be a positive whole number');
	}
	return parsed;
}

function cleanAsOfDate(value: string | null): string | null {
	if (!value) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw error(400, 'asOf must be in YYYY-MM-DD format');
	}
	const parsed = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) {
		throw error(400, 'asOf is invalid');
	}
	return value;
}

function toDateOnly(value: Date | string): string {
	if (value instanceof Date) {
		return value.toISOString().slice(0, 10);
	}
	if (typeof value === 'string') {
		return value.slice(0, 10);
	}
	return '';
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

export const GET: RequestHandler = async ({ locals, cookies, url }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId } = await getActorContext(currentUser.id, cookies);
	const hasStartDate = await employeeTypesHasStartDate(pool);
	const hasVersions = await employeeTypeVersionsEnabled(pool);
	const asOf = cleanAsOfDate(url.searchParams.get('asOf'));
	const asOfDate = asOf ?? new Date().toISOString().slice(0, 10);
	const startDateExpression = hasStartDate ? 'et.StartDate' : 'CAST(et.CreatedAt AS date)';

	const result = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('asOfDate', asOfDate)
		.query(
			hasVersions
				? `SELECT
					et.EmployeeTypeId,
					et.DisplayOrder,
					COALESCE(v.Name, et.Name) AS Name,
					COALESCE(v.PatternId, et.PatternId) AS PatternId,
					COALESCE(v.StartDate, ${startDateExpression}) AS StartDate,
					p.Name AS PatternName
				 FROM dbo.EmployeeTypes et
				 OUTER APPLY (
					SELECT TOP (1)
						etv.Name,
						etv.PatternId,
						etv.StartDate
					FROM dbo.EmployeeTypeVersions etv
					WHERE etv.ScheduleId = et.ScheduleId
					  AND etv.EmployeeTypeId = et.EmployeeTypeId
					  AND etv.IsActive = 1
					  AND etv.DeletedAt IS NULL
					  AND etv.StartDate <= @asOfDate
					  AND (etv.EndDate IS NULL OR etv.EndDate >= @asOfDate)
					ORDER BY etv.StartDate DESC
				 ) v
				 LEFT JOIN dbo.Patterns p
					ON p.PatternId = COALESCE(v.PatternId, et.PatternId)
				   AND p.ScheduleId = et.ScheduleId
				   AND p.IsActive = 1
				   AND p.DeletedAt IS NULL
				 WHERE et.ScheduleId = @scheduleId
				   AND et.IsActive = 1
				   AND et.DeletedAt IS NULL
				 ORDER BY et.DisplayOrder ASC, Name ASC, et.EmployeeTypeId ASC;`
				: `SELECT
					et.EmployeeTypeId,
					et.DisplayOrder,
					et.Name,
					et.PatternId,
					${startDateExpression} AS StartDate,
					p.Name AS PatternName
				 FROM dbo.EmployeeTypes et
				 LEFT JOIN dbo.Patterns p
					ON p.PatternId = et.PatternId
				   AND p.ScheduleId = et.ScheduleId
				   AND p.IsActive = 1
				   AND p.DeletedAt IS NULL
				 WHERE et.ScheduleId = @scheduleId
				   AND et.IsActive = 1
				   AND et.DeletedAt IS NULL
				 ORDER BY et.DisplayOrder ASC, et.Name ASC, et.EmployeeTypeId ASC;`
		);

	const shifts = (result.recordset as ShiftRow[]).map((row) => ({
		employeeTypeId: row.EmployeeTypeId,
		sortOrder: Number(row.DisplayOrder),
		name: row.Name,
		patternId: row.PatternId ?? null,
		pattern: row.PatternName?.trim() || '',
		startDate: toDateOnly(row.StartDate)
	}));

	return json({ shifts });
};

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId, actorOid } = await getActorContext(currentUser.id, cookies);
	const body = await request.json().catch(() => null);

	const name = cleanRequiredText(body?.name, 50, 'Shift name');
	const patternId = cleanOptionalPatternId(body?.patternId);
	const startDate = cleanStartDate(body?.startDate);
	const requestedSortOrder = cleanSortOrder(body?.sortOrder ?? body?.displayOrder);

	if (patternId !== null) {
		const patternResult = await pool
			.request()
			.input('scheduleId', scheduleId)
			.input('patternId', patternId)
			.query(
				`SELECT TOP (1) PatternId
				 FROM dbo.Patterns
				 WHERE ScheduleId = @scheduleId
				   AND PatternId = @patternId
				   AND IsActive = 1
				   AND DeletedAt IS NULL;`
			);
		if (!patternResult.recordset?.[0]?.PatternId) {
			throw error(400, 'Selected pattern does not exist');
		}
	}

	const duplicateResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('name', name)
		.query(
			`SELECT TOP (1) EmployeeTypeId
			 FROM dbo.EmployeeTypes
			 WHERE ScheduleId = @scheduleId
			   AND UPPER(LTRIM(RTRIM(Name))) = UPPER(LTRIM(RTRIM(@name)))
			   AND IsActive = 1
			   AND DeletedAt IS NULL;`
		);
	if (duplicateResult.recordset?.[0]?.EmployeeTypeId) {
		throw error(400, 'A shift with this name already exists');
	}

	const hasStartDate = await employeeTypesHasStartDate(pool);
	const hasVersions = await employeeTypeVersionsEnabled(pool);
	const transaction = new sql.Transaction(pool);
	await transaction.begin();
	try {
		const tx = transaction.request().input('scheduleId', scheduleId);
		await tx.query(
			`WITH Ordered AS (
				SELECT
					EmployeeTypeId,
					ROW_NUMBER() OVER (
						ORDER BY DisplayOrder ASC, Name ASC, EmployeeTypeId ASC
					) AS NextDisplayOrder
				FROM dbo.EmployeeTypes
				WHERE ScheduleId = @scheduleId
				  AND IsActive = 1
				  AND DeletedAt IS NULL
			)
			UPDATE et
			   SET DisplayOrder = o.NextDisplayOrder
			FROM dbo.EmployeeTypes et
			INNER JOIN Ordered o
			  ON o.EmployeeTypeId = et.EmployeeTypeId
			WHERE et.ScheduleId = @scheduleId
			  AND et.IsActive = 1
			  AND et.DeletedAt IS NULL
			  AND et.DisplayOrder <> o.NextDisplayOrder;`
		);

		const countResult = await transaction
			.request()
			.input('scheduleId', scheduleId)
			.query(
				`SELECT COUNT(*) AS ShiftCount
			 FROM dbo.EmployeeTypes
			 WHERE ScheduleId = @scheduleId
			   AND IsActive = 1
			   AND DeletedAt IS NULL;`
			);
		const shiftCount = Number(countResult.recordset?.[0]?.ShiftCount ?? 0);
		const maxSortOrder = shiftCount + 1;
		const targetSortOrder = requestedSortOrder ?? maxSortOrder;
		if (targetSortOrder < 1 || targetSortOrder > maxSortOrder) {
			throw error(400, `Sort order must be between 1 and ${maxSortOrder}`);
		}

		await transaction
			.request()
			.input('scheduleId', scheduleId)
			.input('targetSortOrder', targetSortOrder)
			.query(
				`UPDATE dbo.EmployeeTypes
				 SET DisplayOrder = DisplayOrder + 1
				 WHERE ScheduleId = @scheduleId
				   AND IsActive = 1
				   AND DeletedAt IS NULL
				   AND DisplayOrder >= @targetSortOrder;`
			);

		const insertRequest = transaction
			.request()
			.input('scheduleId', scheduleId)
			.input('name', name)
			.input('displayOrder', targetSortOrder)
			.input('patternId', patternId)
			.input('actorOid', actorOid);

		if (hasStartDate) {
			insertRequest.input('startDate', startDate);
			await insertRequest.query(
				`INSERT INTO dbo.EmployeeTypes (
					ScheduleId,
					Name,
					StartDate,
					DisplayOrder,
					PatternId,
					CreatedBy
				)
				VALUES (
					@scheduleId,
					@name,
					@startDate,
					@displayOrder,
					@patternId,
					@actorOid
				);`
			);
		} else {
			await insertRequest.query(
				`INSERT INTO dbo.EmployeeTypes (
					ScheduleId,
					Name,
					DisplayOrder,
					PatternId,
					CreatedBy
				)
				VALUES (
					@scheduleId,
					@name,
					@displayOrder,
					@patternId,
					@actorOid
				);`
			);
		}

		if (hasVersions) {
			const employeeResult = await transaction
				.request()
				.input('scheduleId', scheduleId)
				.input('name', name)
				.query(
					`SELECT TOP (1) EmployeeTypeId
					 FROM dbo.EmployeeTypes
					 WHERE ScheduleId = @scheduleId
					   AND UPPER(LTRIM(RTRIM(Name))) = UPPER(LTRIM(RTRIM(@name)))
					   AND IsActive = 1
					   AND DeletedAt IS NULL
					 ORDER BY EmployeeTypeId DESC;`
				);
			const insertedEmployeeTypeId = Number(employeeResult.recordset?.[0]?.EmployeeTypeId ?? 0);
			if (!insertedEmployeeTypeId) {
				throw error(500, 'Failed to create shift version');
			}

			await transaction
				.request()
				.input('scheduleId', scheduleId)
				.input('employeeTypeId', insertedEmployeeTypeId)
				.input('startDate', startDate)
				.input('name', name)
				.input('patternId', patternId)
				.input('actorOid', actorOid)
				.query(
				`INSERT INTO dbo.EmployeeTypeVersions (
					ScheduleId,
					EmployeeTypeId,
					StartDate,
					EndDate,
					Name,
					PatternId,
					CreatedBy
				)
				VALUES (
					@scheduleId,
					@employeeTypeId,
					@startDate,
					NULL,
					@name,
					@patternId,
					@actorOid
				);`
				);
		}
		await transaction.commit();
	} catch (err) {
		await transaction.rollback();
		throw err;
	}

	return json({ success: true }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId, actorOid } = await getActorContext(currentUser.id, cookies);
	const body = await request.json().catch(() => null);
	const employeeTypeId = Number(body?.employeeTypeId);
	if (!Number.isInteger(employeeTypeId) || employeeTypeId <= 0) {
		throw error(400, 'Shift ID is required');
	}

	const name = cleanRequiredText(body?.name, 50, 'Shift name');
	const patternId = cleanOptionalPatternId(body?.patternId);
	const startDate = cleanStartDate(body?.startDate);
	const requestedSortOrder = cleanSortOrder(body?.sortOrder ?? body?.displayOrder);

	const existsResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('employeeTypeId', employeeTypeId)
		.query(
			`SELECT TOP (1) EmployeeTypeId
			 FROM dbo.EmployeeTypes
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId
			   AND IsActive = 1
			   AND DeletedAt IS NULL;`
		);
	if (!existsResult.recordset?.[0]?.EmployeeTypeId) {
		throw error(404, 'Shift not found');
	}

	if (patternId !== null) {
		const patternResult = await pool
			.request()
			.input('scheduleId', scheduleId)
			.input('patternId', patternId)
			.query(
				`SELECT TOP (1) PatternId
				 FROM dbo.Patterns
				 WHERE ScheduleId = @scheduleId
				   AND PatternId = @patternId
				   AND IsActive = 1
				   AND DeletedAt IS NULL;`
			);
		if (!patternResult.recordset?.[0]?.PatternId) {
			throw error(400, 'Selected pattern does not exist');
		}
	}

	const duplicateResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('employeeTypeId', employeeTypeId)
		.input('name', name)
		.query(
			`SELECT TOP (1) EmployeeTypeId
			 FROM dbo.EmployeeTypes
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId <> @employeeTypeId
			   AND UPPER(LTRIM(RTRIM(Name))) = UPPER(LTRIM(RTRIM(@name)))
			   AND IsActive = 1
			   AND DeletedAt IS NULL;`
		);
	if (duplicateResult.recordset?.[0]?.EmployeeTypeId) {
		throw error(400, 'A shift with this name already exists');
	}

	const hasStartDate = await employeeTypesHasStartDate(pool);
	const hasVersions = await employeeTypeVersionsEnabled(pool);
	const transaction = new sql.Transaction(pool);
	await transaction.begin();
	try {
		await transaction
			.request()
			.input('scheduleId', scheduleId)
			.query(
				`WITH Ordered AS (
					SELECT
						EmployeeTypeId,
						ROW_NUMBER() OVER (
							ORDER BY DisplayOrder ASC, Name ASC, EmployeeTypeId ASC
						) AS NextDisplayOrder
					FROM dbo.EmployeeTypes
					WHERE ScheduleId = @scheduleId
					  AND IsActive = 1
					  AND DeletedAt IS NULL
				)
				UPDATE et
				   SET DisplayOrder = o.NextDisplayOrder
				FROM dbo.EmployeeTypes et
				INNER JOIN Ordered o
				  ON o.EmployeeTypeId = et.EmployeeTypeId
				WHERE et.ScheduleId = @scheduleId
				  AND et.IsActive = 1
				  AND et.DeletedAt IS NULL
				  AND et.DisplayOrder <> o.NextDisplayOrder;`
			);

		const contextResult = await transaction
			.request()
			.input('scheduleId', scheduleId)
			.input('employeeTypeId', employeeTypeId)
			.query(
				`SELECT
					(SELECT COUNT(*)
					 FROM dbo.EmployeeTypes
					 WHERE ScheduleId = @scheduleId
					   AND IsActive = 1
					   AND DeletedAt IS NULL) AS ShiftCount,
					(SELECT TOP (1) DisplayOrder
					 FROM dbo.EmployeeTypes
					 WHERE ScheduleId = @scheduleId
					   AND EmployeeTypeId = @employeeTypeId
					   AND IsActive = 1
					   AND DeletedAt IS NULL) AS CurrentSortOrder;`
			);
		const shiftCount = Number(contextResult.recordset?.[0]?.ShiftCount ?? 0);
		const currentSortOrder = Number(contextResult.recordset?.[0]?.CurrentSortOrder ?? 0);
		if (!currentSortOrder) {
			throw error(404, 'Shift not found');
		}
		const maxSortOrder = Math.max(shiftCount, 1);
		const targetSortOrder = requestedSortOrder ?? currentSortOrder;
		if (targetSortOrder < 1 || targetSortOrder > maxSortOrder) {
			throw error(400, `Sort order must be between 1 and ${maxSortOrder}`);
		}

		if (targetSortOrder < currentSortOrder) {
			await transaction
				.request()
				.input('scheduleId', scheduleId)
				.input('employeeTypeId', employeeTypeId)
				.input('targetSortOrder', targetSortOrder)
				.input('currentSortOrder', currentSortOrder)
				.query(
					`UPDATE dbo.EmployeeTypes
					 SET DisplayOrder = DisplayOrder + 1
					 WHERE ScheduleId = @scheduleId
					   AND IsActive = 1
					   AND DeletedAt IS NULL
					   AND EmployeeTypeId <> @employeeTypeId
					   AND DisplayOrder >= @targetSortOrder
					   AND DisplayOrder < @currentSortOrder;`
				);
		} else if (targetSortOrder > currentSortOrder) {
			await transaction
				.request()
				.input('scheduleId', scheduleId)
				.input('employeeTypeId', employeeTypeId)
				.input('targetSortOrder', targetSortOrder)
				.input('currentSortOrder', currentSortOrder)
				.query(
					`UPDATE dbo.EmployeeTypes
					 SET DisplayOrder = DisplayOrder - 1
					 WHERE ScheduleId = @scheduleId
					   AND IsActive = 1
					   AND DeletedAt IS NULL
					   AND EmployeeTypeId <> @employeeTypeId
					   AND DisplayOrder > @currentSortOrder
					   AND DisplayOrder <= @targetSortOrder;`
				);
		}

		const updateRequest = transaction
			.request()
			.input('scheduleId', scheduleId)
			.input('employeeTypeId', employeeTypeId)
			.input('name', name)
			.input('patternId', patternId)
			.input('displayOrder', targetSortOrder)
			.input('actorOid', actorOid);

		if (hasVersions) {
			const timelineResult = await transaction
				.request()
				.input('scheduleId', scheduleId)
				.input('employeeTypeId', employeeTypeId)
				.input('effectiveStartDate', startDate)
				.query(
					`SELECT
						(SELECT TOP (1) StartDate
						 FROM dbo.EmployeeTypeVersions
						 WHERE ScheduleId = @scheduleId
						   AND EmployeeTypeId = @employeeTypeId
						   AND IsActive = 1
						   AND DeletedAt IS NULL
						   AND StartDate > @effectiveStartDate
						 ORDER BY StartDate ASC) AS NextStartDate,
						(SELECT TOP (1) StartDate
						 FROM dbo.EmployeeTypeVersions
						 WHERE ScheduleId = @scheduleId
						   AND EmployeeTypeId = @employeeTypeId
						   AND IsActive = 1
						   AND DeletedAt IS NULL
						   AND StartDate = @effectiveStartDate) AS ExactStartDate,
						(SELECT TOP (1) StartDate
						 FROM dbo.EmployeeTypeVersions
						 WHERE ScheduleId = @scheduleId
						   AND EmployeeTypeId = @employeeTypeId
						   AND IsActive = 1
						   AND DeletedAt IS NULL
						   AND StartDate < @effectiveStartDate
						   AND (EndDate IS NULL OR EndDate >= @effectiveStartDate)
						 ORDER BY StartDate DESC) AS ContainingStartDate;`
				);

			const nextStartDate = toDateOnly(timelineResult.recordset?.[0]?.NextStartDate ?? '');
			const exactStartDate = toDateOnly(timelineResult.recordset?.[0]?.ExactStartDate ?? '');
			const containingStartDate = toDateOnly(timelineResult.recordset?.[0]?.ContainingStartDate ?? '');

			const targetEndDate = nextStartDate
				? toDateOnly(
						new Date(
							new Date(`${nextStartDate}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000
						)
				  )
				: null;

			if (containingStartDate) {
				await transaction
					.request()
					.input('scheduleId', scheduleId)
					.input('employeeTypeId', employeeTypeId)
					.input('containingStartDate', containingStartDate)
					.input('effectiveStartDate', startDate)
					.input('actorOid', actorOid)
					.query(
						`UPDATE dbo.EmployeeTypeVersions
						 SET EndDate = DATEADD(day, -1, @effectiveStartDate),
							 EndedAt = SYSUTCDATETIME(),
							 EndedBy = @actorOid,
							 UpdatedAt = SYSUTCDATETIME(),
							 UpdatedBy = @actorOid
						 WHERE ScheduleId = @scheduleId
						   AND EmployeeTypeId = @employeeTypeId
						   AND StartDate = @containingStartDate
						   AND IsActive = 1
						   AND DeletedAt IS NULL;`
					);
			}

			if (exactStartDate) {
				await transaction
					.request()
					.input('scheduleId', scheduleId)
					.input('employeeTypeId', employeeTypeId)
					.input('effectiveStartDate', startDate)
					.input('name', name)
					.input('patternId', patternId)
					.input('targetEndDate', targetEndDate)
					.input('actorOid', actorOid)
					.query(
						`UPDATE dbo.EmployeeTypeVersions
						 SET Name = @name,
							 PatternId = @patternId,
							 EndDate = @targetEndDate,
							 UpdatedAt = SYSUTCDATETIME(),
							 UpdatedBy = @actorOid
						 WHERE ScheduleId = @scheduleId
						   AND EmployeeTypeId = @employeeTypeId
						   AND StartDate = @effectiveStartDate
						   AND IsActive = 1
						   AND DeletedAt IS NULL;`
					);
			} else {
				await transaction
					.request()
					.input('scheduleId', scheduleId)
					.input('employeeTypeId', employeeTypeId)
					.input('effectiveStartDate', startDate)
					.input('targetEndDate', targetEndDate)
					.input('name', name)
					.input('patternId', patternId)
					.input('actorOid', actorOid)
					.query(
						`INSERT INTO dbo.EmployeeTypeVersions (
							ScheduleId,
							EmployeeTypeId,
							StartDate,
							EndDate,
							Name,
							PatternId,
							CreatedBy
						)
						VALUES (
							@scheduleId,
							@employeeTypeId,
							@effectiveStartDate,
							@targetEndDate,
							@name,
							@patternId,
							@actorOid
						);`
					);
			}

			await updateRequest.query(
				hasStartDate
					? `UPDATE et
						 SET et.Name = latest.Name,
							 et.StartDate = latest.StartDate,
							 et.DisplayOrder = @displayOrder,
							 et.PatternId = latest.PatternId,
							 et.UpdatedAt = SYSUTCDATETIME(),
							 et.UpdatedBy = @actorOid
						FROM dbo.EmployeeTypes et
						CROSS APPLY (
							SELECT TOP (1) etv.Name, etv.PatternId, etv.StartDate
							FROM dbo.EmployeeTypeVersions etv
							WHERE etv.ScheduleId = et.ScheduleId
							  AND etv.EmployeeTypeId = et.EmployeeTypeId
							  AND etv.IsActive = 1
							  AND etv.DeletedAt IS NULL
							ORDER BY etv.StartDate DESC
						) latest
						WHERE et.ScheduleId = @scheduleId
						  AND et.EmployeeTypeId = @employeeTypeId
						  AND et.IsActive = 1
						  AND et.DeletedAt IS NULL;`
					: `UPDATE et
						 SET et.Name = latest.Name,
							 et.DisplayOrder = @displayOrder,
							 et.PatternId = latest.PatternId,
							 et.UpdatedAt = SYSUTCDATETIME(),
							 et.UpdatedBy = @actorOid
						FROM dbo.EmployeeTypes et
						CROSS APPLY (
							SELECT TOP (1) etv.Name, etv.PatternId
							FROM dbo.EmployeeTypeVersions etv
							WHERE etv.ScheduleId = et.ScheduleId
							  AND etv.EmployeeTypeId = et.EmployeeTypeId
							  AND etv.IsActive = 1
							  AND etv.DeletedAt IS NULL
							ORDER BY etv.StartDate DESC
						) latest
						WHERE et.ScheduleId = @scheduleId
						  AND et.EmployeeTypeId = @employeeTypeId
						  AND et.IsActive = 1
						  AND et.DeletedAt IS NULL;`
			);
		} else if (hasStartDate) {
			updateRequest.input('startDate', startDate);
			await updateRequest.query(
				`UPDATE dbo.EmployeeTypes
				 SET Name = @name,
					 StartDate = @startDate,
					 DisplayOrder = @displayOrder,
					 PatternId = @patternId,
					 UpdatedAt = SYSUTCDATETIME(),
					 UpdatedBy = @actorOid
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId
				   AND IsActive = 1
				   AND DeletedAt IS NULL;`
			);
		} else {
			await updateRequest.query(
				`UPDATE dbo.EmployeeTypes
				 SET Name = @name,
					 DisplayOrder = @displayOrder,
					 PatternId = @patternId,
					 UpdatedAt = SYSUTCDATETIME(),
					 UpdatedBy = @actorOid
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId
				   AND IsActive = 1
				   AND DeletedAt IS NULL;`
			);
		}
		await transaction.commit();
	} catch (err) {
		await transaction.rollback();
		throw err;
	}

	return json({ success: true });
};
