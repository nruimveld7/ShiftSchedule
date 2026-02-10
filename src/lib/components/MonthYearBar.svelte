<script lang="ts">
  import Picker, { type PickerItem } from '$lib/components/Picker.svelte';

  export let monthLabel = '';
  export let months: PickerItem[] = [];
  export let years: PickerItem[] = [];
  export let selectedMonthIndex: number;
  export let selectedYear: number;
  export let onMonthSelect: (value: number) => void = () => {};
  export let onYearSelect: (value: number) => void = () => {};
  export let onToday: () => void = () => {};

  let monthOpen = false;
  let yearOpen = false;

  function setMonthOpen(next: boolean) {
    monthOpen = next;
    if (next) yearOpen = false;
  }

  function setYearOpen(next: boolean) {
    yearOpen = next;
    if (next) monthOpen = false;
  }
  $: selectedMonthLabel = months.find((m) => m.value === selectedMonthIndex)?.label ?? '';
  $: selectedYearLabel = years.find((y) => y.value === selectedYear)?.label ?? String(selectedYear);
</script>

<div class="monthbar">
  <div class="monthbar-inner">
    <div class="monthbar-title">{monthLabel}</div>
    <div class="monthbar-controls">
      <Picker
        id="monthBtn"
        menuId="monthMenu"
        label="Month"
        items={months}
        selectedValue={selectedMonthIndex}
        selectedLabel={selectedMonthLabel}
        open={monthOpen}
        onOpenChange={setMonthOpen}
        on:select={(event) => onMonthSelect(event.detail as number)}
      />

      <Picker
        id="yearBtn"
        menuId="yearMenu"
        label="Year"
        items={years}
        selectedValue={selectedYear}
        selectedLabel={selectedYearLabel}
        open={yearOpen}
        onOpenChange={setYearOpen}
        on:select={(event) => onYearSelect(event.detail as number)}
      />

      <select
        class="nativeHidden"
        aria-hidden="true"
        tabindex="-1"
        aria-label="Month"
        bind:value={selectedMonthIndex}
      >
        {#each months as month}
          <option value={month.value}>{month.label}</option>
        {/each}
      </select>

      <select
        class="nativeHidden"
        aria-hidden="true"
        tabindex="-1"
        aria-label="Year"
        bind:value={selectedYear}
      >
        {#each years as year}
          <option value={year.value}>{year.label}</option>
        {/each}
      </select>

      <button class="btn primary" type="button" on:click={onToday}>Today</button>
    </div>
  </div>
</div>
