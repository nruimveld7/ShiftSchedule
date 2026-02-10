<script lang="ts">
  import type { MonthDay } from '$lib/utils/date';
  import { indicatorFor, statusForEmployeeDay } from '$lib/utils/status';
  import type { Employee, Status } from '$lib/data/demoData';

  export let employee: Employee;
  export let monthDays: MonthDay[] = [];
  export let overrides: Record<string, { day: number; status: Status }[]>;

  $: rowData = monthDays.map((day) => {
    const status = statusForEmployeeDay(employee, day.day, day.dow, overrides);
    return { day, status, indicator: indicatorFor(status) };
  });

  function dayClass(day: MonthDay) {
    return `cell center${day.isWeekend ? ' wknd' : ''}`;
  }
</script>

<div class="cell namecol" role="rowheader">
  <div class="person">
    <div class="n">{employee.name}</div>
  </div>
</div>

{#each rowData as cell}
  <div class={dayClass(cell.day)} role="gridcell">
    {#if cell.indicator.txt}
      <div
        class={`indicator ${cell.indicator.cls}`}
        role="img"
        aria-label={cell.status}
        title={cell.status}
      >
        <span class={`glyph ${cell.indicator.g ?? ''}`}>{cell.indicator.txt}</span>
      </div>
    {:else}
      <div
        class={`indicator ${cell.indicator.cls}`}
        role="img"
        aria-label={cell.status}
        title={cell.status}
      ></div>
    {/if}
  </div>
{/each}
