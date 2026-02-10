<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  export type PickerItem = { value: number | string; label: string };

  export let id = '';
  export let menuId = '';
  export let label = '';
  export let items: PickerItem[] = [];
  export let selectedValue: number | string;
  export let selectedLabel = '';
  export let open = false;
  export let onOpenChange: (next: boolean) => void = () => {};

  const dispatch = createEventDispatcher<{ select: number | string }>();

  let rootEl: HTMLDivElement | null = null;

  $: resolvedMenuId = menuId || `${id}-menu`;

  function setOpen(next: boolean) {
    if (open === next) return;
    open = next;
    onOpenChange(next);
  }

  function toggle() {
    setOpen(!open);
  }

  function select(value: number | string) {
    dispatch('select', value);
    setOpen(false);
  }

  function handleDocClick(event: MouseEvent) {
    if (!open || !rootEl) return;
    const target = event.target as Node;
    if (!rootEl.contains(target)) setOpen(false);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  onMount(() => {
    document.addEventListener('click', handleDocClick);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('click', handleDocClick);
      document.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<div class="picker" bind:this={rootEl}>
  <button
    class="pickerBtn"
    id={id}
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={resolvedMenuId}
    on:click|stopPropagation={toggle}
  >
    <span>{selectedLabel}</span>
    <span class="chev" aria-hidden="true">▾</span>
  </button>
  <div
    class={`pickerMenu${open ? ' open' : ''}`}
    id={resolvedMenuId}
    role="listbox"
    aria-label={label}
  >
    {#each items as item}
      <button
        class="pickerItem"
        type="button"
        role="option"
        aria-selected={item.value === selectedValue}
        on:click={() => select(item.value)}
      >
        <span>{item.label}</span>
        {#if item.value === selectedValue}
          <span class="check">✓</span>
        {/if}
      </button>
    {/each}
  </div>
</div>
