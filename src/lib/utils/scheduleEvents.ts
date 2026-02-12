export type EventScopeType = 'global' | 'shift' | 'user';
export type EventDisplayMode = 'Schedule Overlay' | 'Badge Indicator' | 'Shift Override';

export type ScheduleEvent = {
	eventId: number;
	scopeType: EventScopeType;
	employeeTypeId: number | null;
	userOid: string | null;
	startDate: string;
	endDate: string;
	eventDisplayMode: EventDisplayMode;
	eventCodeColor: string;
};

type CellContext = {
	scopeType: EventScopeType;
	employeeTypeId: number | null;
	userOid: string | null;
};

export type CellEventVisuals = {
	overrideBackground: string | null;
	overlayBackground: string | null;
	badgeBackground: string | null;
};

function normalizeHexColor(value: string, fallback = '#22c55e'): string {
	const trimmed = value.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
	return fallback;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const normalized = normalizeHexColor(hex, '#22c55e').slice(1);
	return {
		r: Number.parseInt(normalized.slice(0, 2), 16),
		g: Number.parseInt(normalized.slice(2, 4), 16),
		b: Number.parseInt(normalized.slice(4, 6), 16)
	};
}

function toRgba(hex: string, alpha: number): string {
	const { r, g, b } = hexToRgb(hex);
	const clampedAlpha = Math.max(0, Math.min(1, alpha));
	return `rgba(${r}, ${g}, ${b}, ${clampedAlpha.toFixed(2)})`;
}

function buildLinearGradient(colors: string[]): string {
	if (colors.length <= 1) return colors[0] ?? '#22c55e';
	if (colors.length === 2) return `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)`;
	const steps = colors.map((color, index) => {
		const stop = Math.round((index / (colors.length - 1)) * 100);
		return `${color} ${stop}%`;
	});
	return `linear-gradient(135deg, ${steps.join(', ')})`;
}

function scopeRank(scopeType: EventScopeType): number {
	if (scopeType === 'user') return 3;
	if (scopeType === 'shift') return 2;
	return 1;
}

function appliesToCell(eventRow: ScheduleEvent, context: CellContext): boolean {
	if (eventRow.scopeType !== context.scopeType) return false;
	if (context.scopeType === 'global') return true;
	if (context.scopeType === 'shift') {
		return context.employeeTypeId !== null && eventRow.employeeTypeId === context.employeeTypeId;
	}
	if (!context.userOid || !eventRow.userOid) return false;
	return context.userOid.trim().toLowerCase() === eventRow.userOid.trim().toLowerCase();
}

function appliesToCellForOverlay(eventRow: ScheduleEvent, context: CellContext): boolean {
	if (eventRow.scopeType === 'global') return true;
	if (eventRow.scopeType === 'shift') {
		return context.employeeTypeId !== null && eventRow.employeeTypeId === context.employeeTypeId;
	}
	if (!context.userOid || !eventRow.userOid) return false;
	return context.userOid.trim().toLowerCase() === eventRow.userOid.trim().toLowerCase();
}

function appliesToDay(eventRow: ScheduleEvent, dayIso: string): boolean {
	return eventRow.startDate <= dayIso && eventRow.endDate >= dayIso;
}

function resolveModeBackground(
	events: ScheduleEvent[],
	displayMode: EventDisplayMode,
	opacity: number | null
): string | null {
	const modeEvents = events.filter((eventRow) => eventRow.eventDisplayMode === displayMode);
	if (modeEvents.length === 0) return null;
	const bestScopeRank = Math.max(...modeEvents.map((eventRow) => scopeRank(eventRow.scopeType)));
	const scopeEvents = modeEvents
		.filter((eventRow) => scopeRank(eventRow.scopeType) === bestScopeRank)
		.sort((left, right) => left.eventId - right.eventId);
	const colors = scopeEvents.map((eventRow) => normalizeHexColor(eventRow.eventCodeColor));
	if (opacity === null) return buildLinearGradient(colors);
	const rgbaColors = colors.map((color) => toRgba(color, opacity));
	return buildLinearGradient(rgbaColors);
}

export function resolveCellEventVisuals(
	events: ScheduleEvent[],
	dayIso: string,
	context: CellContext
): CellEventVisuals {
	const dayApplicable = events.filter((eventRow) => appliesToDay(eventRow, dayIso));
	if (dayApplicable.length === 0) {
		return {
			overrideBackground: null,
			overlayBackground: null,
			badgeBackground: null
		};
	}

	return {
		overrideBackground: resolveModeBackground(
			dayApplicable.filter((eventRow) => appliesToCell(eventRow, context)),
			'Shift Override',
			null
		),
		overlayBackground: resolveModeBackground(
			dayApplicable.filter((eventRow) => appliesToCellForOverlay(eventRow, context)),
			'Schedule Overlay',
			0.33
		),
		badgeBackground: resolveModeBackground(
			dayApplicable.filter((eventRow) => appliesToCell(eventRow, context)),
			'Badge Indicator',
			null
		)
	};
}
