<script lang="ts">
  import type { MonthDay } from '$lib/utils/date';

  export let groupName = '';
  export let employeeCount = 0;
  export let collapsed = false;
  export let monthDays: MonthDay[] = [];
  export let onToggle: () => void = () => {};

  $: ariaLabel = `${groupName}. ${employeeCount} people. ${collapsed ? 'Collapsed' : 'Expanded'}.`;
  $: caret = collapsed ? '▸' : '▾';
  function dayClass(day: MonthDay) {
    return `cell${day.isWeekend ? ' wknd' : ''}`;
  }
</script>

<div
  class="cell namecol"
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
    <span class="groupMeta">{employeeCount} people</span>
  </div>
</div>

{#each monthDays as day}
  <div class={dayClass(day)} role="gridcell"></div>
{/each}
