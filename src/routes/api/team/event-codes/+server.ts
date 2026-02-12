import { error, json } from '@sveltejs/kit';
import type { Cookies, RequestHandler } from '@sveltejs/kit';
import { GetPool } from '$lib/server/db';
import { getActiveScheduleId } from '$lib/server/auth';

type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';
type EventCodeDisplayMode = 'Schedule Overlay' | 'Badge Indicator' | 'Shift Override';

type EventCodeRow = {
	CoverageCodeId: number;
	Code: string;
	Label: string | null;
	DisplayMode: EventCodeDisplayMode | null;
	Color: string | null;
	IsActive: boolean;
};

const allowedDisplayModes = new Set<EventCodeDisplayMode>([
	'Schedule Overlay',
	'Badge Indicator',
	'Shift Override'
]);

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

function cleanCode(value: unknown): string {
	if (typeof value !== 'string') {
		throw error(400, 'Event code is required');
	}
	const normalized = value.trim().toUpperCase().replace(/\s+/g, '-');
	if (!normalized) {
		throw error(400, 'Event code is required');
	}
	if (!/^[A-Z0-9_-]{1,16}$/.test(normalized)) {
		throw error(400, 'Event code must be 1-16 characters and use A-Z, 0-9, "_" or "-"');
	}
	return normalized;
}

function cleanName(value: unknown): string {
	if (typeof value !== 'string') {
		throw error(400, 'Display name is required');
	}
	const trimmed = value.trim();
	if (!trimmed) {
		throw error(400, 'Display name is required');
	}
	return trimmed.slice(0, 60);
}

function cleanDisplayMode(value: unknown): EventCodeDisplayMode {
	if (typeof value !== 'string' || !allowedDisplayModes.has(value as EventCodeDisplayMode)) {
		throw error(400, 'Display mode is invalid');
	}
	return value as EventCodeDisplayMode;
}

function cleanColor(value: unknown): string {
	if (typeof value !== 'string') {
		throw error(400, 'Color is required');
	}
	const trimmed = value.trim().toLowerCase();
	if (!/^#[0-9a-f]{6}$/.test(trimmed)) {
		throw error(400, 'Color must be a hex value like #22c55e');
	}
	return trimmed;
}

function cleanIsActive(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw error(400, 'Status is required');
	}
	return value;
}

function cleanEventCodeId(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw error(400, 'Event code ID is required');
	}
	return parsed;
}

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId } = await getActorContext(currentUser.id, cookies);
	const result = await pool.request().input('scheduleId', scheduleId).query(
		`SELECT
			CoverageCodeId,
			Code,
			Label,
			DisplayMode,
			Color,
			IsActive
		 FROM dbo.CoverageCodes
		 WHERE ScheduleId = @scheduleId
		   AND DeletedAt IS NULL
		 ORDER BY SortOrder ASC, Code ASC, CoverageCodeId ASC;`
	);

	const eventCodes = (result.recordset as EventCodeRow[]).map((row) => ({
		eventCodeId: Number(row.CoverageCodeId),
		code: row.Code?.trim() ?? '',
		name: row.Label?.trim() || row.Code?.trim() || '',
		displayMode: (row.DisplayMode ?? 'Schedule Overlay') as EventCodeDisplayMode,
		color: row.Color?.trim() || '#22c55e',
		isActive: Boolean(row.IsActive)
	}));

	return json({ eventCodes });
};

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId, actorOid } = await getActorContext(currentUser.id, cookies);
	const body = await request.json().catch(() => null);
	const code = cleanCode(body?.code);
	const name = cleanName(body?.name);
	const displayMode = cleanDisplayMode(body?.displayMode);
	const color = cleanColor(body?.color);
	const isActive = cleanIsActive(body?.isActive);

	const duplicateResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('code', code)
		.query(
			`SELECT TOP (1) CoverageCodeId
			 FROM dbo.CoverageCodes
			 WHERE ScheduleId = @scheduleId
			   AND Code = @code
			   AND DeletedAt IS NULL;`
		);
	if (duplicateResult.recordset?.[0]?.CoverageCodeId) {
		throw error(400, 'An event code with this code already exists in this schedule.');
	}

	const countResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.query(
			`SELECT COUNT(*) AS EventCodeCount
			 FROM dbo.CoverageCodes
			 WHERE ScheduleId = @scheduleId
			   AND DeletedAt IS NULL;`
		);
	const nextSortOrder = Number(countResult.recordset?.[0]?.EventCodeCount ?? 0) + 1;

	await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('code', code)
		.input('name', name)
		.input('displayMode', displayMode)
		.input('color', color)
		.input('isActive', isActive)
		.input('sortOrder', nextSortOrder)
		.input('actorOid', actorOid)
		.query(
			`INSERT INTO dbo.CoverageCodes (
				ScheduleId,
				Code,
				Label,
				DisplayMode,
				Color,
				SortOrder,
				IsActive,
				CreatedBy
			)
			VALUES (
				@scheduleId,
				@code,
				@name,
				@displayMode,
				@color,
				@sortOrder,
				@isActive,
				@actorOid
			);`
		);

	return json({ success: true }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId } = await getActorContext(currentUser.id, cookies);
	const body = await request.json().catch(() => null);
	const eventCodeId = cleanEventCodeId(body?.eventCodeId);
	const code = cleanCode(body?.code);
	const name = cleanName(body?.name);
	const displayMode = cleanDisplayMode(body?.displayMode);
	const color = cleanColor(body?.color);
	const isActive = cleanIsActive(body?.isActive);

	const existsResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('eventCodeId', eventCodeId)
		.query(
			`SELECT TOP (1) CoverageCodeId
			 FROM dbo.CoverageCodes
			 WHERE ScheduleId = @scheduleId
			   AND CoverageCodeId = @eventCodeId
			   AND DeletedAt IS NULL;`
		);
	if (!existsResult.recordset?.[0]?.CoverageCodeId) {
		throw error(404, 'Event code not found');
	}

	const duplicateResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('eventCodeId', eventCodeId)
		.input('code', code)
		.query(
			`SELECT TOP (1) CoverageCodeId
			 FROM dbo.CoverageCodes
			 WHERE ScheduleId = @scheduleId
			   AND CoverageCodeId <> @eventCodeId
			   AND Code = @code
			   AND DeletedAt IS NULL;`
		);
	if (duplicateResult.recordset?.[0]?.CoverageCodeId) {
		throw error(400, 'An event code with this code already exists in this schedule.');
	}

	await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('eventCodeId', eventCodeId)
		.input('code', code)
		.input('name', name)
		.input('displayMode', displayMode)
		.input('color', color)
		.input('isActive', isActive)
		.query(
			`UPDATE dbo.CoverageCodes
			 SET Code = @code,
				 Label = @name,
				 DisplayMode = @displayMode,
				 Color = @color,
				 IsActive = @isActive
			 WHERE ScheduleId = @scheduleId
			   AND CoverageCodeId = @eventCodeId
			   AND DeletedAt IS NULL;`
		);

	return json({ success: true });
};
