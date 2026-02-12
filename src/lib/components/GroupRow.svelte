<script lang="ts">
	import type { MonthDay } from '$lib/utils/date';
	import type { ScheduleEvent } from '$lib/data/demoData';
	import { resolveCellEventVisuals } from '$lib/utils/scheduleEvents';

	export let groupName = '';
	export let employeeTypeId: number | null = null;
	export let events: ScheduleEvent[] = [];
	export let selectedYear = new Date().getFullYear();
	export let selectedMonthIndex = new Date().getMonth();
	export let employeeCount = 0;
	export let collapsed = false;
	export let monthDays: MonthDay[] = [];
	export let selectedDay: number | null = null;
	export let selectedGroupIndex: number | null = null;
	export let groupIndex = -1;
	export let isLastVisibleRow = false;
	export let onSelectDay: (day: number) => void = () => {};
	export let onDoubleClickDay: (day: MonthDay) => void = () => {};
	export let onToggle: () => void = () => {};
	$: personLabel = employeeCount === 1 ? 'person' : 'people';
	$: ariaLabel = `${groupName}. ${employeeCount} ${personLabel}. ${collapsed ? 'Collapsed' : 'Expanded'}.`;
	$: caret = collapsed ? '▸' : '▾';
	function dayClass(day: MonthDay) {
		return `cell shiftRowCell${day.isWeekend ? ' wknd' : ''}`;
	}

	function dayIso(day: number): string {
		const month = String(selectedMonthIndex + 1).padStart(2, '0');
		const dayPart = String(day).padStart(2, '0');
		return `${selectedYear}-${month}-${dayPart}`;
	}

	$: dayEventVisuals = new Map(
		monthDays.map((day) => [
			day.day,
			resolveCellEventVisuals(events, dayIso(day.day), {
				scopeType: 'shift',
				employeeTypeId,
				userOid: null
			})
		] as const)
	);

	function handleDayCellClick(day: number, event: MouseEvent) {
		// Ignore the second click of a double-click sequence.
		if (event.detail > 1) return;
		onSelectDay(day);
	}
</script>

<div
	class="cell namecol shiftRowCell"
	role="button"
	style="cursor: pointer;"
	tabindex="0"
	aria-expanded={!collapsed}
	aria-label={ariaLabel}
	on:click={onToggle}
	on:keydown={(event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onToggle();
		}
	}}
>
	<div class="groupRow">
		<span style="display:flex;align-items:center;gap:10px;">
			<span class="caret" aria-hidden="true">{caret}</span>
			<span>{groupName}</span>
		</span>
		{#if employeeCount == 1}
			<span class="groupMeta">{employeeCount} person</span>
		{:else}
			<span class="groupMeta">{employeeCount} people</span>
		{/if}
	</div>
</div>

{#each monthDays as day}
	{@const visuals = dayEventVisuals.get(day.day)}
	<div
		class={dayClass(day)}
		data-scope="shift-day"
		data-group-index={groupIndex}
		data-day={day.day}
		role="button"
		tabindex="0"
		aria-label={`Select ${groupName} on day ${day.day}`}
		on:click={(event) => handleDayCellClick(day.day, event)}
		on:dblclick={() => onDoubleClickDay(day)}
		on:keydown={(event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				onSelectDay(day.day);
			}
		}}
	>
		{#if visuals?.overrideBackground}
			<div
				class="cellShiftOverrideBg"
				style={`--event-shift-override-bg:${visuals.overrideBackground};`}
				aria-hidden="true"
			></div>
		{/if}
		{#if visuals?.overlayBackground}
			<div
				class="cellEventOverlay"
				style={`--event-overlay-bg:${visuals.overlayBackground};`}
				aria-hidden="true"
			></div>
		{/if}
		{#if visuals?.badgeBackground}
			<div
				class="cellEventBadge"
				style={`--event-badge-bg:${visuals.badgeBackground};`}
				aria-hidden="true"
			></div>
		{/if}
	</div>
{/each}
