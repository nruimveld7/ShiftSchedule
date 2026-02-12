<script lang="ts">
	import { base } from '$app/paths';
	import { afterUpdate, onDestroy, onMount } from 'svelte';
	import { dowShort, monthNames } from '$lib/utils/date';
	import type { MonthDay } from '$lib/utils/date';
	import DatePicker from '$lib/components/DatePicker.svelte';
	import Picker from '$lib/components/Picker.svelte';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import GroupRow from '$lib/components/GroupRow.svelte';
	import EmployeeRow from '$lib/components/EmployeeRow.svelte';
	import type { Employee, Group, ScheduleEvent, Status } from '$lib/data/demoData';
	import { resolveCellEventVisuals } from '$lib/utils/scheduleEvents';

	type EventScopeType = 'global' | 'shift' | 'user';
	type PopupMode = 'list' | 'add' | 'edit';
	type EventDisplayMode = 'Schedule Overlay' | 'Badge Indicator' | 'Shift Override';
	type EventCodeOption = {
		eventCodeId: number;
		code: string;
		name: string;
		displayMode: EventDisplayMode;
		color: string;
		isActive: boolean;
	};
	type ScopedEventEntry = {
		eventId: number;
		eventCodeId: number | null;
		eventCodeCode: string;
		eventCodeName: string;
		eventDisplayMode: EventDisplayMode;
		eventCodeColor: string;
		startDate: string;
		endDate: string;
		comments: string;
	};
	type PickerOption = { value: number | string; label: string; color?: string };

	export let groups: Group[] = [];
	export let events: ScheduleEvent[] = [];
	export let overrides: Record<string, { day: number; status: Status }[]> = {};
	export let collapsed: Record<string, boolean> = {};
	export let monthDays: MonthDay[] = [];
	export let theme: 'light' | 'dark' = 'dark';
	export let onToggleGroup: (groupName: string) => void = () => {};
	export let canMaintainTeam = false;
	export let onTeamClick: () => void = () => {};
	export let onEmployeeDoubleClick: (employee: Employee) => void = () => {};
	export let onScheduleRefresh: () => void | Promise<void> = () => {};
	export let selectedYear = new Date().getFullYear();
	export let selectedMonthIndex = new Date().getMonth();

	let gridEl: HTMLDivElement | null = null;
	let bandEl: HTMLDivElement | null = null;
	let selectedBandEl: HTMLDivElement | null = null;
	let scopedSelectedBandEl: HTMLDivElement | null = null;
	let gridWrapEl: HTMLDivElement | null = null;
	let horizontalRailEl: HTMLDivElement | null = null;
	let resizeQueued = false;
	let mounted = false;
	let showHorizontalScrollbar = false;
	let horizontalThumbWidthPx = 0;
	let horizontalThumbLeftPx = 0;
	let isDraggingHorizontalScrollbar = false;
	let dragStartX = 0;
	let dragStartHorizontalThumbLeftPx = 0;
	let selectedRowKey: string | null = null;
	let selectedDay: number | null = null;
	let selectedGroupIndex: number | null = null;
	let lastSelectionContextKey = `${selectedYear}-${selectedMonthIndex}`;
	let memberEventsPopupOpen = false;
	let memberEventsPopupTitle = '';
	let memberEventsPopupDayIso = '';
	let memberEventsPopupScopeType: EventScopeType = 'global';
	let memberEventsPopupScopeEmployeeTypeId: number | null = null;
	let memberEventsPopupScopeUserOid: string | null = null;
	let memberEventsPopupMode: PopupMode = 'list';
	let editingEventId: number | null = null;

	let scopedEventEntries: ScopedEventEntry[] = [];
	let memberEventsLoading = false;
	let memberEventsError = '';
	let eventSaveInProgress = false;

	let eventCodeOptions: EventCodeOption[] = [];
	let eventCodesLoading = false;
	let eventCodesError = '';
	let eventCodePickerOpen = false;
	let customDisplayModePickerOpen = false;
	let addStartDatePickerOpen = false;
	let addEndDatePickerOpen = false;

	let addEventCodeId = '';
	let addEventComments = '';
	let addEventStartDate = '';
	let addEventEndDate = '';
	let addCustomEventCode = '';
	let addCustomEventName = '';
	let addCustomEventDisplayMode: EventDisplayMode = 'Schedule Overlay';
	let addCustomEventColor = '#22c55e';
	let addEventError = '';

	const eventDisplayModeItems: PickerOption[] = [
		{ value: 'Schedule Overlay', label: 'Schedule Overlay' },
		{ value: 'Badge Indicator', label: 'Badge Indicator' },
		{ value: 'Shift Override', label: 'Shift Override' }
	];

	$: days = monthDays;
	$: dim = monthDays.length;
	$: gridTemplateRows = (() => {
		const tracks: string[] = ['var(--schedule-header-row-height)'];
		for (const group of groups) {
			// Shift/group rows should size to content.
			tracks.push('auto');
			if (!collapsed[group.category]) {
				// User rows should keep the existing min/max stretch behavior.
				for (let i = 0; i < group.employees.length; i += 1) {
					tracks.push('minmax(var(--schedule-row-min-height), var(--schedule-row-max-height))');
				}
			}
		}
		return tracks.join(' ');
	})();
	$: gridStyle = `grid-template-columns: clamp(220px, 20vw, 360px) repeat(${dim}, minmax(34px, 1fr)); grid-template-rows: ${gridTemplateRows}; min-width: ${Math.max(260 + dim * 40, 1100)}px;`;
	$: activeTodayDay = monthDays.find((item) => item.isToday)?.day ?? null;
	$: dayHeaderEventVisuals = new Map(
		monthDays.map(
			(day) =>
				[
					day.day,
					resolveCellEventVisuals(events, toIsoDate(selectedYear, selectedMonthIndex, day.day), {
						scopeType: 'global',
						employeeTypeId: null,
						userOid: null
					})
				] as const
		)
	);

	function dayHeaderClass(day: MonthDay) {
		let cls = `cell hdr dayhdr${day.isWeekend ? ' wknd' : ''}`;
		if (day.isToday) cls += ' todayhdr';
		return cls;
	}

	function dayAriaLabel(day: MonthDay) {
		return `Day ${day.day} ${dowShort[day.dow]}`;
	}

	function dayDowShort(day: MonthDay) {
		return dowShort[day.dow];
	}

	function toIsoDate(year: number, monthIndex: number, day: number): string {
		const month = String(monthIndex + 1).padStart(2, '0');
		const dayPart = String(day).padStart(2, '0');
		return `${year}-${month}-${dayPart}`;
	}

	function formatIsoDate(iso: string): string {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
		const [yearRaw, monthRaw, dayRaw] = iso.split('-');
		const year = Number(yearRaw);
		const month = Number(monthRaw);
		const day = Number(dayRaw);
		if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return iso;
		return `${monthNames[month - 1]} ${day}, ${year}`;
	}

	function formatPopupDate(day: MonthDay): string {
		const cellDate = new Date(selectedYear, selectedMonthIndex, day.day);
		return `${monthNames[cellDate.getMonth()]} ${cellDate.getDate()}, ${cellDate.getFullYear()}`;
	}

	function refreshScheduleInBackground() {
		try {
			void onScheduleRefresh();
		} catch {
			// Keep event operations successful even if background refresh fails.
		}
	}

	async function openMemberEventsPopup(
		day: MonthDay,
		scopeType: EventScopeType,
		scopeLabel: string | null = null,
		scopeEmployeeTypeId: number | null = null,
		scopeUserOid: string | null = null
	) {
		const dateLabel = formatPopupDate(day);
		const normalizedScopeLabel = scopeLabel?.trim() ?? '';
		memberEventsPopupTitle = `${dateLabel} Events${normalizedScopeLabel ? ` - ${normalizedScopeLabel}` : ''}`;
		memberEventsPopupDayIso = toIsoDate(selectedYear, selectedMonthIndex, day.day);
		memberEventsPopupScopeType = scopeType;
		memberEventsPopupScopeEmployeeTypeId = scopeEmployeeTypeId;
		memberEventsPopupScopeUserOid = scopeUserOid;
		memberEventsPopupMode = 'list';
		memberEventsError = '';
		resetAddEventForm();
		memberEventsPopupOpen = true;
		await loadScopedEvents();
	}

	function closeMemberEventsPopup() {
		memberEventsPopupOpen = false;
		memberEventsPopupMode = 'list';
		scopedEventEntries = [];
		memberEventsLoading = false;
		memberEventsError = '';
		editingEventId = null;
	}

	function parseErrorMessage(result: Response, fallback: string): Promise<string> {
		return result
			.json()
			.then((payload) => {
				if (payload && typeof payload === 'object') {
					const message =
						typeof (payload as Record<string, unknown>).message === 'string'
							? (payload as Record<string, string>).message
							: typeof (payload as Record<string, unknown>).error === 'string'
								? (payload as Record<string, string>).error
								: '';
					if (message.trim()) return message;
				}
				return fallback;
			})
			.catch(() => fallback);
	}

	async function loadScopedEvents() {
		if (!memberEventsPopupDayIso) return;
		if (memberEventsPopupScopeType === 'shift' && !memberEventsPopupScopeEmployeeTypeId) {
			memberEventsError = 'This shift cannot be resolved for event lookups.';
			scopedEventEntries = [];
			return;
		}
		if (memberEventsPopupScopeType === 'user' && !memberEventsPopupScopeUserOid) {
			memberEventsError = 'This user cannot be resolved for event lookups.';
			scopedEventEntries = [];
			return;
		}

		memberEventsLoading = true;
		memberEventsError = '';
		try {
			const queryParts = [
				`day=${encodeURIComponent(memberEventsPopupDayIso)}`,
				`scope=${encodeURIComponent(memberEventsPopupScopeType)}`
			];
			if (memberEventsPopupScopeEmployeeTypeId) {
				queryParts.push(
					`employeeTypeId=${encodeURIComponent(String(memberEventsPopupScopeEmployeeTypeId))}`
				);
			}
			if (memberEventsPopupScopeType === 'user' && memberEventsPopupScopeUserOid) {
				queryParts.push(`userOid=${encodeURIComponent(memberEventsPopupScopeUserOid)}`);
			}

			const result = await fetch(`${base}/api/team/events?${queryParts.join('&')}`, {
				method: 'GET',
				headers: { accept: 'application/json' }
			});
			if (!result.ok) {
				throw new Error(await parseErrorMessage(result, 'Failed to load events'));
			}
			const payload = (await result.json()) as {
				events?: Array<{
					eventId: number;
					eventCodeId: number | null;
					eventCodeCode: string;
					eventCodeName: string;
					eventDisplayMode: EventDisplayMode;
					eventCodeColor: string;
					startDate: string;
					endDate: string;
					comments: string;
				}>;
			};
			scopedEventEntries = Array.isArray(payload.events) ? payload.events : [];
		} catch (error) {
			scopedEventEntries = [];
			memberEventsError = error instanceof Error ? error.message : 'Failed to load events';
		} finally {
			memberEventsLoading = false;
		}
	}

	async function loadActiveEventCodes() {
		if (!canMaintainTeam || eventCodesLoading || eventCodeOptions.length > 0) return;

		eventCodesLoading = true;
		eventCodesError = '';
		try {
			const result = await fetch(`${base}/api/team/event-codes`, { method: 'GET' });
			if (!result.ok) {
				throw new Error(await parseErrorMessage(result, 'Failed to load active event codes'));
			}
			const data = (await result.json()) as {
				eventCodes?: Array<{
					eventCodeId: number;
					code: string;
					name: string;
					displayMode: EventDisplayMode;
					color: string;
					isActive: boolean;
				}>;
			};
			eventCodeOptions = (Array.isArray(data.eventCodes) ? data.eventCodes : [])
				.filter((eventCode) => eventCode.isActive)
				.map((eventCode) => ({
					eventCodeId: eventCode.eventCodeId,
					code: eventCode.code,
					name: eventCode.name,
					displayMode: eventCode.displayMode ?? 'Schedule Overlay',
					color: eventCode.color,
					isActive: Boolean(eventCode.isActive)
				}));
		} catch (error) {
			eventCodesError =
				error instanceof Error ? error.message : 'Failed to load active event codes';
		} finally {
			eventCodesLoading = false;
		}
	}

	function resetAddEventForm() {
		addEventCodeId = 'custom';
		addEventComments = '';
		addEventStartDate = memberEventsPopupDayIso;
		addEventEndDate = memberEventsPopupDayIso;
		addCustomEventCode = '';
		addCustomEventName = '';
		addCustomEventDisplayMode = 'Schedule Overlay';
		addCustomEventColor = '#22c55e';
		addEventError = '';
		editingEventId = null;
		eventCodePickerOpen = false;
		customDisplayModePickerOpen = false;
		addStartDatePickerOpen = false;
		addEndDatePickerOpen = false;
	}

	async function openAddEventView() {
		if (!canMaintainTeam) return;
		memberEventsPopupMode = 'add';
		resetAddEventForm();
		await loadActiveEventCodes();
	}

	async function openEditEventView(eventRow: ScopedEventEntry) {
		if (!canMaintainTeam) return;
		await loadActiveEventCodes();

		memberEventsPopupMode = 'edit';
		addEventError = '';
		editingEventId = eventRow.eventId;
		addEventComments = eventRow.comments;
		addEventStartDate = eventRow.startDate;
		addEventEndDate = eventRow.endDate;

		const matchedEventCode =
			typeof eventRow.eventCodeId === 'number' && eventRow.eventCodeId > 0
				? eventCodeOptions.find((item) => item.eventCodeId === eventRow.eventCodeId)
				: null;

		if (matchedEventCode) {
			addEventCodeId = String(matchedEventCode.eventCodeId);
			addCustomEventCode = '';
			addCustomEventName = '';
			addCustomEventDisplayMode = 'Schedule Overlay';
			addCustomEventColor = '#22c55e';
		} else {
			addEventCodeId = 'custom';
			addCustomEventCode = eventRow.eventCodeCode;
			addCustomEventName = eventRow.eventCodeName;
			addCustomEventDisplayMode = eventRow.eventDisplayMode;
			addCustomEventColor = eventRow.eventCodeColor;
		}

		eventCodePickerOpen = false;
		customDisplayModePickerOpen = false;
		addStartDatePickerOpen = false;
		addEndDatePickerOpen = false;
	}

	function cancelAddEvent() {
		memberEventsPopupMode = 'list';
		resetAddEventForm();
	}

	function isIsoDate(value: string): boolean {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
		const [yearRaw, monthRaw, dayRaw] = value.split('-');
		const year = Number(yearRaw);
		const month = Number(monthRaw);
		const day = Number(dayRaw);
		if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
		const parsed = new Date(year, month - 1, day);
		return (
			parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
		);
	}

	async function saveEvent() {
		if (eventSaveInProgress) return;
		addEventError = '';

		if (memberEventsPopupScopeType === 'shift' && !memberEventsPopupScopeEmployeeTypeId) {
			addEventError = 'This shift cannot be resolved for event updates.';
			return;
		}
		if (memberEventsPopupScopeType === 'user' && !memberEventsPopupScopeUserOid) {
			addEventError = 'This user cannot be resolved for event updates.';
			return;
		}

		const isCustomCode = addEventCodeId === 'custom';
		if (!isIsoDate(addEventStartDate) || !isIsoDate(addEventEndDate)) {
			addEventError = 'Please choose a valid start and end date.';
			return;
		}
		if (addEventEndDate < addEventStartDate) {
			addEventError = 'End date cannot be before start date.';
			return;
		}

		let coverageCodeId: number | null = null;
		let customCode: string | null = null;
		let customName: string | null = null;
		let customDisplayMode: EventDisplayMode | null = null;
		let customColor: string | null = null;

		if (isCustomCode) {
			const normalizedCode = addCustomEventCode.trim().toUpperCase().replace(/\s+/g, '-');
			if (!normalizedCode) {
				addEventError = 'Custom event code is required.';
				return;
			}
			if (!/^[A-Z0-9_-]{1,16}$/.test(normalizedCode)) {
				addEventError = 'Custom event code must be 1-16 chars using A-Z, 0-9, _ or -.';
				return;
			}
			const normalizedColor = addCustomEventColor.trim().toLowerCase();
			if (!/^#[0-9a-f]{6}$/.test(normalizedColor)) {
				addEventError = 'Custom event color must be a valid hex value.';
				return;
			}
			customCode = normalizedCode;
			customName = addCustomEventName.trim() || normalizedCode;
			customDisplayMode = addCustomEventDisplayMode;
			customColor = normalizedColor;
		} else {
			const selectedCodeId = Number(addEventCodeId);
			if (!Number.isInteger(selectedCodeId) || selectedCodeId <= 0) {
				addEventError = 'Please select an event code.';
				return;
			}

			const eventCode = eventCodeOptions.find((item) => item.eventCodeId === selectedCodeId);
			if (!eventCode) {
				addEventError = 'Selected event code is no longer available.';
				return;
			}

			coverageCodeId = eventCode.eventCodeId;
		}

		const payload: Record<string, unknown> = {
			scope: memberEventsPopupScopeType,
			employeeTypeId: memberEventsPopupScopeEmployeeTypeId,
			userOid: memberEventsPopupScopeUserOid,
			startDate: addEventStartDate,
			endDate: addEventEndDate,
			comments: addEventComments.trim(),
			coverageCodeId
		};

		if (customCode) {
			payload.customCode = customCode;
			payload.customName = customName;
			payload.customDisplayMode = customDisplayMode;
			payload.customColor = customColor;
		}

		const isEditing = memberEventsPopupMode === 'edit' && editingEventId !== null;
		if (isEditing) {
			payload.eventId = editingEventId;
		}

		eventSaveInProgress = true;
		try {
			const result = await fetch(`${base}/api/team/events`, {
				method: isEditing ? 'PATCH' : 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json'
				},
				body: JSON.stringify(payload)
			});
			if (!result.ok) {
				throw new Error(await parseErrorMessage(result, 'Failed to save event'));
			}

			memberEventsPopupMode = 'list';
			resetAddEventForm();
			refreshScheduleInBackground();
			await loadScopedEvents();
		} catch (error) {
			addEventError = error instanceof Error ? error.message : 'Failed to save event';
		} finally {
			eventSaveInProgress = false;
		}
	}

	async function removeEvent() {
		if (eventSaveInProgress || editingEventId === null) return;
		addEventError = '';
		eventSaveInProgress = true;
		try {
			const result = await fetch(`${base}/api/team/events`, {
				method: 'DELETE',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json'
				},
				body: JSON.stringify({ eventId: editingEventId })
			});
			if (!result.ok) {
				throw new Error(await parseErrorMessage(result, 'Failed to remove event'));
			}
			memberEventsPopupMode = 'list';
			resetAddEventForm();
			refreshScheduleInBackground();
			await loadScopedEvents();
		} catch (error) {
			addEventError = error instanceof Error ? error.message : 'Failed to remove event';
		} finally {
			eventSaveInProgress = false;
		}
	}

	function handleDayHeaderDoubleClick(day: MonthDay) {
		void openMemberEventsPopup(day, 'global');
	}

	function handleDayHeaderClick(day: number, event: MouseEvent) {
		// Ignore the second click of a double-click sequence.
		if (event.detail > 1) return;
		handleDaySelect(day);
	}

	function handleGroupDayDoubleClick(group: Group, day: MonthDay) {
		void openMemberEventsPopup(day, 'shift', group.category, group.employeeTypeId ?? null, null);
	}

	function handleEmployeeDayDoubleClick(
		employee: Employee,
		groupEmployeeTypeId: number | null,
		day: MonthDay
	) {
		void openMemberEventsPopup(
			day,
			'user',
			employee.name,
			groupEmployeeTypeId,
			employee.userOid ?? null
		);
	}

	function setEventCodePickerOpen(next: boolean) {
		eventCodePickerOpen = next;
	}

	function setAddStartDatePickerOpen(next: boolean) {
		addStartDatePickerOpen = next;
	}

	function setCustomDisplayModePickerOpen(next: boolean) {
		customDisplayModePickerOpen = next;
	}

	function setAddEndDatePickerOpen(next: boolean) {
		addEndDatePickerOpen = next;
	}

	function refreshBandMeasurements(
		_theme: 'light' | 'dark',
		_monthDays: MonthDay[],
		_activeDay: number | null
	) {
		void _theme;
		void _monthDays;
		void _activeDay;
		if (!mounted) return;
		queueMeasure();
	}

	function refreshScrollbarForData(
		_groups: Group[],
		_collapsed: Record<string, boolean>,
		_monthDays: MonthDay[]
	) {
		void _groups;
		void _collapsed;
		void _monthDays;
		if (typeof window !== 'undefined') {
			requestAnimationFrame(updateCustomScrollbar);
		}
	}

	$: activeEventCodeItems = [
		{ value: 'custom', label: 'Custom' },
		...eventCodeOptions.map((eventCode) => ({
			value: eventCode.eventCodeId,
			label: `${eventCode.code} - ${eventCode.name}`,
			color: eventCode.color
		}))
	] satisfies PickerOption[];

	$: selectedEventCodeLabel =
		activeEventCodeItems.find((item) => String(item.value) === addEventCodeId)?.label ??
		(eventCodesLoading ? 'Loading...' : 'Select event code');

	$: isCustomEventCodeSelected = addEventCodeId === 'custom';

	$: selectedCustomDisplayModeLabel =
		eventDisplayModeItems.find((item) => item.value === addCustomEventDisplayMode)?.label ??
		'Schedule Overlay';

	$: addEventPrimaryButtonLabel = eventSaveInProgress
		? memberEventsPopupMode === 'edit'
			? 'Saving...'
			: 'Adding...'
		: memberEventsPopupMode === 'edit'
			? 'Save'
			: 'Add';

	$: scopedPopupEvents = [...scopedEventEntries].sort((left, right) =>
		left.startDate.localeCompare(right.startDate)
	);

	function activateTeamCell() {
		if (!canMaintainTeam) return;
		onTeamClick();
	}

	function makeRowKey(groupName: string, employeeId: string) {
		return `${groupName}::${employeeId}`;
	}

	function handleRowSelect(rowKey: string) {
		if (selectedRowKey === rowKey) {
			selectedRowKey = null;
			return;
		}
		selectedRowKey = rowKey;
		selectedDay = null;
		selectedGroupIndex = null;
	}

	function handleDaySelect(day: number) {
		if (selectedDay === day && selectedGroupIndex === null) {
			selectedDay = null;
			selectedGroupIndex = null;
			return;
		}
		selectedRowKey = null;
		selectedDay = day;
		selectedGroupIndex = null;
	}

	function handleGroupDaySelect(groupIndex: number, day: number) {
		if (selectedDay === day && selectedGroupIndex === groupIndex) {
			selectedDay = null;
			selectedGroupIndex = null;
			return;
		}
		selectedRowKey = null;
		selectedDay = day;
		selectedGroupIndex = groupIndex;
	}

	function clearSelectionState() {
		selectedRowKey = null;
		selectedDay = null;
		selectedGroupIndex = null;
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function measureDayBand(day: number | null, band: HTMLDivElement | null) {
		if (!gridEl || !band || !day) return;
		const headerCell = gridEl.querySelector(`.dayhdr[data-day='${day}']`) as HTMLDivElement | null;
		if (!headerCell) return;
		const lastCell = gridEl.querySelector('.cell:last-of-type') as HTMLDivElement | null;
		if (!lastCell) return;
		const bandBottom = lastCell.offsetTop + lastCell.offsetHeight;
		const minBandBottom = headerCell.offsetTop + headerCell.offsetHeight;
		const bandHeight = Math.max(bandBottom, minBandBottom);
		band.style.left = `${headerCell.offsetLeft}px`;
		band.style.width = `${headerCell.offsetWidth}px`;
		band.style.top = '0px';
		band.style.height = `${bandHeight}px`;
	}

	function measureScopedDayBand(
		day: number | null,
		groupIndex: number | null,
		band: HTMLDivElement | null
	) {
		if (!gridEl || !band || !day || groupIndex === null) return;
		const shiftCell = gridEl.querySelector(
			`.cell[data-scope='shift-day'][data-day='${day}'][data-group-index='${groupIndex}']`
		) as HTMLDivElement | null;
		if (!shiftCell) return;
		const endEmployeeCell = gridEl.querySelector(
			`.cell[data-scope='employee-day'][data-day='${day}'][data-group-index='${groupIndex}'][data-group-end='true']`
		) as HTMLDivElement | null;
		const bandBottomCell = endEmployeeCell ?? shiftCell;
		const bandBottom = bandBottomCell.offsetTop + bandBottomCell.offsetHeight;
		band.style.left = `${shiftCell.offsetLeft}px`;
		band.style.width = `${shiftCell.offsetWidth}px`;
		band.style.top = `${shiftCell.offsetTop}px`;
		band.style.height = `${Math.max(bandBottom - shiftCell.offsetTop, shiftCell.offsetHeight)}px`;
	}

	function queueMeasure() {
		if (resizeQueued) return;
		resizeQueued = true;
		requestAnimationFrame(() => {
			resizeQueued = false;
			measureDayBand(activeTodayDay, bandEl);
			measureDayBand(selectedDay, selectedBandEl);
			measureScopedDayBand(selectedDay, selectedGroupIndex, scopedSelectedBandEl);
		});
	}

	function updateCustomScrollbar() {
		if (!gridWrapEl) return;

		const scrollWidth = gridWrapEl.scrollWidth;
		const clientWidth = gridWrapEl.clientWidth;
		const scrollLeft = gridWrapEl.scrollLeft;
		const hasHorizontalOverflow = scrollWidth > clientWidth + 1;

		showHorizontalScrollbar = hasHorizontalOverflow;
		if (!hasHorizontalOverflow) {
			horizontalThumbWidthPx = 0;
			horizontalThumbLeftPx = 0;
			return;
		}

		const horizontalRailWidth = horizontalRailEl?.clientWidth ?? Math.max(clientWidth - 24, 0);
		if (horizontalRailWidth <= 0) return;

		const minThumbWidth = 48;
		const nextThumbWidth = Math.max(
			minThumbWidth,
			(horizontalRailWidth * clientWidth) / scrollWidth
		);
		const maxThumbLeft = Math.max(horizontalRailWidth - nextThumbWidth, 0);
		const maxScrollLeft = Math.max(scrollWidth - clientWidth, 1);
		const nextThumbLeft = (scrollLeft / maxScrollLeft) * maxThumbLeft;

		horizontalThumbWidthPx = nextThumbWidth;
		horizontalThumbLeftPx = clamp(nextThumbLeft, 0, maxThumbLeft);
	}

	function onGridScroll() {
		if (!isDraggingHorizontalScrollbar) {
			updateCustomScrollbar();
		}
	}

	function setGlobalScrollbarDragging(active: boolean) {
		if (typeof document === 'undefined') return;
		const body = document.body;
		const current = Number(body.dataset.scrollbarDragCount ?? '0');
		const next = Math.max(0, current + (active ? 1 : -1));
		if (next === 0) {
			delete body.dataset.scrollbarDragCount;
		} else {
			body.dataset.scrollbarDragCount = String(next);
		}
		body.classList.toggle('scrollbar-dragging', next > 0);
	}

	function onHorizontalDragMove(event: MouseEvent) {
		if (!isDraggingHorizontalScrollbar || !gridWrapEl || !horizontalRailEl) return;

		const railWidth = horizontalRailEl.clientWidth;
		const maxThumbLeft = Math.max(railWidth - horizontalThumbWidthPx, 0);
		const nextThumbLeft = clamp(
			dragStartHorizontalThumbLeftPx + (event.clientX - dragStartX),
			0,
			maxThumbLeft
		);
		const maxScrollLeft = Math.max(gridWrapEl.scrollWidth - gridWrapEl.clientWidth, 0);

		horizontalThumbLeftPx = nextThumbLeft;
		gridWrapEl.scrollLeft = maxThumbLeft > 0 ? (nextThumbLeft / maxThumbLeft) * maxScrollLeft : 0;
	}

	function stopHorizontalDragging() {
		if (isDraggingHorizontalScrollbar) {
			setGlobalScrollbarDragging(false);
		}
		isDraggingHorizontalScrollbar = false;
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousemove', onHorizontalDragMove);
			window.removeEventListener('mouseup', stopHorizontalDragging);
		}
	}

	function startHorizontalThumbDrag(event: MouseEvent) {
		if (!showHorizontalScrollbar) return;
		event.preventDefault();
		event.stopPropagation();
		isDraggingHorizontalScrollbar = true;
		setGlobalScrollbarDragging(true);
		dragStartX = event.clientX;
		dragStartHorizontalThumbLeftPx = horizontalThumbLeftPx;
		window.addEventListener('mousemove', onHorizontalDragMove);
		window.addEventListener('mouseup', stopHorizontalDragging);
	}

	function handleHorizontalRailClick(event: MouseEvent) {
		if (!gridWrapEl || !horizontalRailEl || !showHorizontalScrollbar) return;
		if (event.target !== horizontalRailEl) return;

		const rect = horizontalRailEl.getBoundingClientRect();
		const desiredLeft = clamp(
			event.clientX - rect.left - horizontalThumbWidthPx / 2,
			0,
			Math.max(rect.width - horizontalThumbWidthPx, 0)
		);
		const maxThumbLeft = Math.max(rect.width - horizontalThumbWidthPx, 1);
		const maxScrollLeft = Math.max(gridWrapEl.scrollWidth - gridWrapEl.clientWidth, 0);
		gridWrapEl.scrollLeft = (desiredLeft / maxThumbLeft) * maxScrollLeft;
		updateCustomScrollbar();
	}

	onMount(() => {
		mounted = true;
		queueMeasure();
		requestAnimationFrame(updateCustomScrollbar);
		const onResize = () => {
			queueMeasure();
			updateCustomScrollbar();
		};
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('resize', onResize);
		};
	});

	afterUpdate(() => {
		queueMeasure();
		updateCustomScrollbar();
	});

	$: refreshBandMeasurements(theme, monthDays, activeTodayDay);

	$: refreshScrollbarForData(groups, collapsed, monthDays);

	$: {
		const nextSelectionContextKey = `${selectedYear}-${selectedMonthIndex}`;
		if (nextSelectionContextKey !== lastSelectionContextKey) {
			lastSelectionContextKey = nextSelectionContextKey;
			clearSelectionState();
		}
	}

	onDestroy(() => {
		stopHorizontalDragging();
	});
</script>

<div class="gridwrapShell">
	<div class="gridwrap" bind:this={gridWrapEl} on:scroll={onGridScroll}>
		<div
			class="grid"
			role="grid"
			aria-label="Shift schedule grid"
			style={gridStyle}
			bind:this={gridEl}
		>
			{#if activeTodayDay}
				<div class="today-band" bind:this={bandEl}></div>
			{/if}
			{#if selectedDay && selectedGroupIndex === null}
				<div class="selected-day-band" bind:this={selectedBandEl}></div>
			{/if}
			{#if selectedDay && selectedGroupIndex !== null}
				<div class="selected-day-band" bind:this={scopedSelectedBandEl}></div>
			{/if}

			{#if canMaintainTeam}
				<div
					class="cell hdr namecol teamHeader clickable"
					role="button"
					tabindex="0"
					aria-label="Configure team and schedule setup"
					on:click={activateTeamCell}
					on:keydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							activateTeamCell();
						}
					}}
				>
					<div class="groupRow">Team</div>
				</div>
			{:else}
				<div class="cell hdr namecol teamHeader" role="columnheader">
					<div class="groupRow">Team</div>
				</div>
			{/if}

			{#each days as day (day.day)}
				{@const headerVisuals = dayHeaderEventVisuals.get(day.day)}
				<div
					class={`${dayHeaderClass(day)} selectableColumnHeader${selectedDay === day.day && selectedGroupIndex === null ? ' columnSelected colStart' : ''}`}
					data-day={day.day}
					role="columnheader"
					aria-label={dayAriaLabel(day)}
					tabindex="0"
					on:click={(event) => handleDayHeaderClick(day.day, event)}
					on:keydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							handleDaySelect(day.day);
						}
					}}
					on:dblclick={() => handleDayHeaderDoubleClick(day)}
				>
					{#if headerVisuals?.overrideBackground}
						<div
							class="cellShiftOverrideBg"
							style={`--event-shift-override-bg:${headerVisuals.overrideBackground};`}
							aria-hidden="true"
						></div>
					{/if}
					{#if headerVisuals?.overlayBackground}
						<div
							class="cellEventOverlay"
							style={`--event-overlay-bg:${headerVisuals.overlayBackground};`}
							aria-hidden="true"
						></div>
					{/if}
					{#if headerVisuals?.badgeBackground}
						<div
							class="dayHeaderEventBadge"
							style={`--event-badge-bg:${headerVisuals.badgeBackground};`}
							aria-hidden="true"
						></div>
					{/if}
					<span class="daynum">{day.day}</span>
					<span class="dow">{dayDowShort(day)}</span>
				</div>
			{/each}

			{#each groups as group, groupIndex (group.category)}
				<GroupRow
					groupName={group.category}
					employeeTypeId={group.employeeTypeId ?? null}
					{events}
					{selectedYear}
					{selectedMonthIndex}
					employeeCount={group.employees.length}
					collapsed={collapsed[group.category] === true}
					{monthDays}
					{selectedDay}
					{selectedGroupIndex}
					{groupIndex}
					isLastVisibleRow={groupIndex === groups.length - 1 &&
						(collapsed[group.category] === true || group.employees.length === 0)}
					onSelectDay={(day) => handleGroupDaySelect(groupIndex, day)}
					onDoubleClickDay={(day) => handleGroupDayDoubleClick(group, day)}
					onToggle={() => onToggleGroup(group.category)}
				/>

				{#if !collapsed[group.category]}
					{#each group.employees as employee, employeeIndex (employee.userOid ?? `${group.category}:${employee.name}:${employeeIndex}`)}
						<EmployeeRow
							{employee}
							groupName={group.category}
							employeeTypeId={group.employeeTypeId ?? null}
							{events}
							{selectedYear}
							{selectedMonthIndex}
							{monthDays}
							{overrides}
							{selectedDay}
							{selectedGroupIndex}
							{groupIndex}
							isLastVisibleRow={groupIndex === groups.length - 1 &&
								employeeIndex === group.employees.length - 1}
							isLastInGroup={employeeIndex === group.employees.length - 1}
							onOpenDisplayNameEditor={onEmployeeDoubleClick}
							rowKey={makeRowKey(group.category, employee.userOid ?? employee.name)}
							{selectedRowKey}
							onSelectRow={handleRowSelect}
							onDoubleClickDayCell={(employee, day) =>
								handleEmployeeDayDoubleClick(employee, group.employeeTypeId ?? null, day)}
						/>
					{/each}
				{/if}
			{/each}
		</div>
	</div>
	{#if memberEventsPopupOpen}
		<div
			class="displayNameModalBackdrop"
			role="presentation"
			on:mousedown={(event) => {
				if (event.target === event.currentTarget) {
					closeMemberEventsPopup();
				}
			}}
		>
			<div
				class="displayNameModal memberEventsModal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="member-events-modal-title"
			>
				<h2 id="member-events-modal-title">{memberEventsPopupTitle}</h2>

				{#if memberEventsPopupMode === 'list'}
					<div class="memberEventsRows">
						{#if memberEventsLoading}
							<div class="memberEventEmptyRow">Loading events...</div>
						{:else if memberEventsError}
							<div class="memberEventError" role="alert">{memberEventsError}</div>
						{:else if scopedPopupEvents.length === 0}
							<div class="memberEventEmptyRow">No Events</div>
						{:else}
							{#each scopedPopupEvents as eventRow (eventRow.eventId)}
								<div
									class={`memberEventRow${canMaintainTeam ? ' editable' : ''}`}
									role={canMaintainTeam ? 'button' : undefined}
									tabindex={canMaintainTeam ? 0 : undefined}
									aria-label={canMaintainTeam ? `Edit event ${eventRow.eventCodeCode}` : undefined}
									on:click={() => {
										if (canMaintainTeam) {
											void openEditEventView(eventRow);
										}
									}}
									on:keydown={(event) => {
										if (!canMaintainTeam) return;
										if (event.key === 'Enter' || event.key === ' ') {
											event.preventDefault();
											void openEditEventView(eventRow);
										}
									}}
								>
									<div class="memberEventCodeLine">
										<span
											class="memberEventColorDot"
											style={`background:${eventRow.eventCodeColor};`}
											aria-hidden="true"
										></span>
										<strong>{eventRow.eventCodeCode}</strong>
										<span>{eventRow.eventCodeName}</span>
									</div>
									<div class="memberEventDates">
										{#if eventRow.startDate === eventRow.endDate}
											{formatIsoDate(eventRow.startDate)}
										{:else}
											{formatIsoDate(eventRow.startDate)} to {formatIsoDate(eventRow.endDate)}
										{/if}
									</div>
									{#if eventRow.comments}
										<div class="memberEventComment">{eventRow.comments}</div>
									{/if}
									{#if canMaintainTeam}
										<div class="memberEventEditOverlay" aria-hidden="true">
											<svg viewBox="0 0 24 24" aria-hidden="true">
												<path
													d="M2.75 21.25l3.85-.96L18.83 8.06l-2.89-2.89L3.71 17.4l-.96 3.85z M16.98 3.88L19.87 6.77L20.91 5.73A2.0435 2.0435 0 0 0 18.02 2.84Z"
													fill="currentColor"
													fill-rule="evenodd"
													clip-rule="evenodd"
												/>
											</svg>
										</div>
									{/if}
								</div>
							{/each}
						{/if}

						{#if canMaintainTeam}
							<button type="button" class="memberEventAddRowBtn" on:click={openAddEventView}>
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<path d="M12 5v14M5 12h14" />
								</svg>
							</button>
						{/if}
					</div>
				{:else}
					<div class="memberEventForm">
						<div class="memberEventField">
							<span class="memberEventFieldLabel">Event Code</span>
							<div class="memberEventPickerWrap">
								<Picker
									id="memberEventCodeBtn"
									menuId="memberEventCodeMenu"
									label="Event Code"
									items={activeEventCodeItems}
									fullWidth={true}
									selectedValue={addEventCodeId === 'custom'
										? 'custom'
										: addEventCodeId
											? Number(addEventCodeId)
											: ''}
									selectedLabel={selectedEventCodeLabel}
									open={eventCodePickerOpen}
									onOpenChange={setEventCodePickerOpen}
									on:select={(event) => {
										addEventCodeId = String(event.detail);
									}}
								/>
							</div>
						</div>

						<label class="memberEventField">
							<span class="memberEventFieldLabel">Comments</span>
							<textarea
								class="input memberEventTextarea"
								rows="3"
								placeholder="Reason or timing details"
								bind:value={addEventComments}
							></textarea>
						</label>

						<div class="memberEventDateFields">
							<div class="memberEventField">
								<span class="memberEventFieldLabel">Start Date</span>
								<DatePicker
									id="memberEventStartDateBtn"
									menuId="memberEventStartDateMenu"
									label="Start Date"
									placeholder="Select start date"
									value={addEventStartDate}
									open={addStartDatePickerOpen}
									onOpenChange={setAddStartDatePickerOpen}
									on:change={(event) => {
										addEventStartDate = event.detail;
									}}
								/>
							</div>
							<div class="memberEventField">
								<span class="memberEventFieldLabel">End Date</span>
								<DatePicker
									id="memberEventEndDateBtn"
									menuId="memberEventEndDateMenu"
									label="End Date"
									placeholder="Select end date"
									value={addEventEndDate}
									min={addEventStartDate}
									open={addEndDatePickerOpen}
									onOpenChange={setAddEndDatePickerOpen}
									on:change={(event) => {
										addEventEndDate = event.detail;
									}}
								/>
							</div>
						</div>

						{#if isCustomEventCodeSelected}
							<div class="memberEventCustomSection">
								<div class="memberEventCustomTitle">Custom Event</div>
								<div class="memberEventCustomFields">
									<label class="memberEventField">
										<span class="memberEventFieldLabel">Code</span>
										<input
											class="input"
											type="text"
											maxlength="16"
											placeholder="e.g. MTG"
											bind:value={addCustomEventCode}
											on:input={(event) => {
												const target = event.currentTarget as HTMLInputElement;
												addCustomEventCode = target.value.toUpperCase();
											}}
										/>
									</label>
									<label class="memberEventField">
										<span class="memberEventFieldLabel">Display Name (optional)</span>
										<input
											class="input"
											type="text"
											maxlength="60"
											placeholder="e.g. Team Meeting"
											bind:value={addCustomEventName}
										/>
									</label>
									<label class="memberEventField">
										<span class="memberEventFieldLabel">Display Type</span>
										<div class="memberEventPickerWrap">
											<Picker
												id="memberEventDisplayModeBtn"
												menuId="memberEventDisplayModeMenu"
												label="Display Type"
												items={eventDisplayModeItems}
												fullWidth={true}
												selectedValue={addCustomEventDisplayMode}
												selectedLabel={selectedCustomDisplayModeLabel}
												open={customDisplayModePickerOpen}
												onOpenChange={setCustomDisplayModePickerOpen}
												on:select={(event) => {
													addCustomEventDisplayMode = event.detail as EventDisplayMode;
												}}
											/>
										</div>
									</label>
									<label class="memberEventField memberEventCustomColorField">
										<span class="memberEventFieldLabel">Color</span>
										<ColorPicker
											id="memberEventCustomColorPicker"
											label="Custom event color"
											value={addCustomEventColor}
											on:change={(event) => (addCustomEventColor = event.detail)}
										/>
									</label>
								</div>
							</div>
						{/if}

						{#if eventCodesError}
							<div class="memberEventError" role="alert">{eventCodesError}</div>
						{/if}
						{#if addEventError}
							<div class="memberEventError" role="alert">{addEventError}</div>
						{/if}
					</div>

					<div class="displayNameModalActions">
						{#if memberEventsPopupMode === 'edit'}
							<button
								type="button"
								class="iconActionBtn danger actionBtn"
								on:click={removeEvent}
								disabled={eventSaveInProgress}
							>
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<path d="M4 7h16M9 7V5h6v2M9 10v8M15 10v8M7 7l1 13h8l1-13" />
								</svg>
								Remove
							</button>
						{/if}
						<button type="button" class="btn actionBtn" on:click={cancelAddEvent}>Cancel</button>
						<button
							type="button"
							class="btn primary actionBtn"
							on:click={saveEvent}
							disabled={eventSaveInProgress}
						>
							{addEventPrimaryButtonLabel}
						</button>
					</div>
				{/if}

				{#if memberEventsPopupMode === 'list'}
					<div class="displayNameModalActions">
						<button type="button" class="btn actionBtn" on:click={closeMemberEventsPopup}
							>Close</button
						>
					</div>
				{/if}
			</div>
		</div>
	{/if}
	{#if showHorizontalScrollbar}
		<div
			class="gridScrollRailHorizontal"
			role="presentation"
			aria-hidden="true"
			bind:this={horizontalRailEl}
			on:mousedown={handleHorizontalRailClick}
		>
			<div
				class="gridScrollThumbHorizontal"
				class:dragging={isDraggingHorizontalScrollbar}
				role="presentation"
				style={`width:${horizontalThumbWidthPx}px;transform:translateX(${horizontalThumbLeftPx}px);`}
				on:mousedown={startHorizontalThumbDrag}
			></div>
		</div>
	{/if}
</div>
