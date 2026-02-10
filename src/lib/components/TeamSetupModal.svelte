<script lang="ts">
  import { base } from '$app/paths';
  import { onDestroy, onMount, tick } from 'svelte';

	type SetupSection = 'users' | 'shifts' | 'assignments';
	type UserRole = 'Member' | 'Maintainer' | 'Manager';
	type UsersViewMode = 'list' | 'add' | 'edit';
	type SortKey = 'name' | 'email' | 'role';
	type SortDirection = 'asc' | 'desc';
	type AccessUser = { name: string; email: string; role: UserRole };
	type EntraUser = {
		id: string;
		displayName?: string;
		mail?: string;
		userPrincipalName?: string;
	};

	export let open = false;
	export let canAssignManagerRole = false;
	export let onClose: () => void = () => {};

	let activeSection: SetupSection = 'users';
	let usersViewMode: UsersViewMode = 'list';
	let selectedUserForEdit: AccessUser | null = null;
	let selectedAddRole: UserRole = 'Member';
	let selectedEditRole: UserRole = 'Member';
	let sortKey: SortKey = 'name';
	let sortDirection: SortDirection = 'asc';
  let modalScrollEl: HTMLDivElement | null = null;
  let railEl: HTMLDivElement | null = null;
  let showCustomScrollbar = false;
  let thumbHeightPx = 0;
  let thumbTopPx = 0;
  let isDraggingScrollbar = false;
  let dragStartY = 0;
  let dragStartThumbTopPx = 0;
	let addUserQuery = '';
	let addUsers: EntraUser[] = [];
	let addUsersError = '';
	let addUsersLoading = false;
	let addUserSearchTimer: ReturnType<typeof setTimeout> | null = null;
	let showAddUserResults = false;
	let addUserComboEl: HTMLDivElement | null = null;

	const sections: { id: SetupSection; label: string }[] = [
		{ id: 'users', label: 'Users' },
		{ id: 'shifts', label: 'Shifts' },
		{ id: 'assignments', label: 'Assignments' }
	];

	const stubUsers: AccessUser[] = [
		{ name: 'Alex Doe', email: 'alex@example.com', role: 'Member' },
		{ name: 'Sam Lee', email: 'sam@example.com', role: 'Maintainer' },
		{ name: 'Chris Park', email: 'chris@example.com', role: 'Member' },
		{ name: 'Taylor Kim', email: 'taylor@example.com', role: 'Maintainer' },
		{ name: 'Jordan Fox', email: 'jordan@example.com', role: 'Member' },
		{ name: 'Riley Quinn', email: 'riley@example.com', role: 'Member' }
	];

	const stubShifts = [
		{ name: 'Days Shift', pattern: '4 on / 4 off', start: '06:00' },
		{ name: 'Nights Shift', pattern: '4 on / 4 off', start: '18:00' }
	];

	const stubAssignments = [
		{ user: 'Alex Doe', shift: 'Days Shift' },
		{ user: 'Sam Lee', shift: 'Nights Shift' }
	];

	function setSection(section: SetupSection) {
		activeSection = section;
		usersViewMode = 'list';
		selectedUserForEdit = null;
	}

	function closeModal() {
		onClose();
	}

	function handleBackdropMouseDown(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			closeModal();
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') closeModal();
	}

	function resetUsersPane() {
		usersViewMode = 'list';
		selectedUserForEdit = null;
		addUserQuery = '';
		addUsers = [];
		addUsersError = '';
		addUsersLoading = false;
		showAddUserResults = false;
		if (addUserSearchTimer) {
			clearTimeout(addUserSearchTimer);
			addUserSearchTimer = null;
		}
	}

	function openAddUserView() {
		addUserQuery = '';
		addUsers = [];
		addUsersError = '';
		addUsersLoading = false;
		showAddUserResults = false;
		if (addUserSearchTimer) {
			clearTimeout(addUserSearchTimer);
			addUserSearchTimer = null;
		}
		selectedAddRole = 'Member';
		usersViewMode = 'add';
	}

	function openEditUserView(user: AccessUser) {
		selectedUserForEdit = user;
		selectedEditRole = user.role;
		usersViewMode = 'edit';
	}

	function toggleSort(nextKey: SortKey) {
		if (sortKey === nextKey) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
			return;
		}
		sortKey = nextKey;
		sortDirection = 'asc';
	}

	function ariaSortFor(key: SortKey): 'none' | 'ascending' | 'descending' {
		if (sortKey !== key) return 'none';
		return sortDirection === 'asc' ? 'ascending' : 'descending';
	}

	function toComparableValue(user: AccessUser, key: SortKey): string {
		if (key === 'name') return user.name;
		if (key === 'email') return user.email;
		return user.role;
	}

	function resetModalState() {
		activeSection = 'users';
		usersViewMode = 'list';
		selectedUserForEdit = null;
		selectedAddRole = 'Member';
		selectedEditRole = 'Member';
		sortKey = 'name';
		sortDirection = 'asc';
		addUserQuery = '';
		addUsers = [];
		addUsersError = '';
		addUsersLoading = false;
		showAddUserResults = false;
		if (addUserSearchTimer) {
			clearTimeout(addUserSearchTimer);
			addUserSearchTimer = null;
		}
	}

	function userLabel(user: EntraUser): string {
		const email = user.mail ?? user.userPrincipalName ?? '';
		const name = (user.displayName ?? '').trim();
		let formattedName = name;
		if (name) {
			if (name.includes(',')) {
				formattedName = name;
			} else {
				const parts = name.split(/\s+/);
				if (parts.length >= 2) {
					const last = parts.pop();
					const first = parts.join(' ');
					formattedName = `${last}, ${first}`;
				}
			}
		}
		if (formattedName && email) return `${formattedName} <${email}>`;
		return formattedName || email || user.id;
	}

	async function loadAddUsers(query = addUserQuery) {
		addUsersLoading = true;
		addUsersError = '';
		try {
			const queryParam = query ? `?q=${encodeURIComponent(query)}` : '';
			const result = await fetch(`${base}/test/api/users${queryParam}`, { method: 'GET' });
			if (!result.ok) {
				const text = await result.text();
				throw new Error(text || `Request failed: ${result.status}`);
			}
			const data = await result.json();
			addUsers = data.users ?? [];
		} catch (error) {
			addUsersError = error instanceof Error ? error.message : 'Failed to load users';
		} finally {
			addUsersLoading = false;
		}
	}

	function onAddUserQueryInput(event: Event) {
		const target = event.target as HTMLInputElement;
		addUserQuery = target.value;
		showAddUserResults = true;
		if (addUserSearchTimer) clearTimeout(addUserSearchTimer);
		addUserSearchTimer = setTimeout(() => {
			void loadAddUsers(addUserQuery);
		}, 300);
	}

	function onAddUserSelect(user: EntraUser) {
		addUserQuery = userLabel(user);
		showAddUserResults = false;
	}

	function closeAddUserResults() {
		showAddUserResults = false;
	}

	function onAddUserFocus() {
		showAddUserResults = true;
		if (addUsers.length === 0 && addUserQuery.trim().length > 0) {
			void loadAddUsers(addUserQuery);
		}
	}

	function onDocumentMouseDown(event: MouseEvent) {
		if (!showAddUserResults) return;
		const target = event.target as Node;
		if (addUserComboEl && !addUserComboEl.contains(target)) {
			showAddUserResults = false;
		}
	}

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function updateCustomScrollbar() {
    if (!modalScrollEl) return;

    const scrollHeight = modalScrollEl.scrollHeight;
    const clientHeight = modalScrollEl.clientHeight;
    const scrollTop = modalScrollEl.scrollTop;
    const hasOverflow = scrollHeight > clientHeight + 1;

    showCustomScrollbar = hasOverflow;
    if (!hasOverflow) {
      thumbHeightPx = 0;
      thumbTopPx = 0;
      return;
    }

    const railHeight = railEl?.clientHeight ?? Math.max(clientHeight - 24, 0);
    if (railHeight <= 0) return;

    const minThumbHeight = 36;
    const nextThumbHeight = Math.max(minThumbHeight, (railHeight * clientHeight) / scrollHeight);
    const maxThumbTop = Math.max(railHeight - nextThumbHeight, 0);
    const maxScrollTop = Math.max(scrollHeight - clientHeight, 1);
    const nextThumbTop = (scrollTop / maxScrollTop) * maxThumbTop;

    thumbHeightPx = nextThumbHeight;
    thumbTopPx = clamp(nextThumbTop, 0, maxThumbTop);
  }

  function onModalScroll() {
    if (!isDraggingScrollbar) {
      updateCustomScrollbar();
    }
  }

  function onDragMove(event: MouseEvent) {
    if (!isDraggingScrollbar || !modalScrollEl || !railEl) return;

    const railHeight = railEl.clientHeight;
    const maxThumbTop = Math.max(railHeight - thumbHeightPx, 0);
    const nextThumbTop = clamp(dragStartThumbTopPx + (event.clientY - dragStartY), 0, maxThumbTop);
    const maxScrollTop = Math.max(modalScrollEl.scrollHeight - modalScrollEl.clientHeight, 0);

    thumbTopPx = nextThumbTop;
    modalScrollEl.scrollTop = maxThumbTop > 0 ? (nextThumbTop / maxThumbTop) * maxScrollTop : 0;
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

  function stopDragging() {
    if (isDraggingScrollbar) {
      setGlobalScrollbarDragging(false);
    }
    isDraggingScrollbar = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', stopDragging);
    }
  }

  function startThumbDrag(event: MouseEvent) {
    if (!showCustomScrollbar) return;
    event.preventDefault();
    event.stopPropagation();
    isDraggingScrollbar = true;
    setGlobalScrollbarDragging(true);
    dragStartY = event.clientY;
    dragStartThumbTopPx = thumbTopPx;
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', stopDragging);
  }

  function handleRailClick(event: MouseEvent) {
    if (!modalScrollEl || !railEl || !showCustomScrollbar) return;
    if (event.target !== railEl) return;

    const rect = railEl.getBoundingClientRect();
    const desiredTop = clamp(event.clientY - rect.top - thumbHeightPx / 2, 0, Math.max(rect.height - thumbHeightPx, 0));
    const maxThumbTop = Math.max(rect.height - thumbHeightPx, 1);
    const maxScrollTop = Math.max(modalScrollEl.scrollHeight - modalScrollEl.clientHeight, 0);
    modalScrollEl.scrollTop = (desiredTop / maxThumbTop) * maxScrollTop;
    updateCustomScrollbar();
  }

	$: sortedUsers = [...stubUsers].sort((a, b) => {
		const aValue = toComparableValue(a, sortKey);
		const bValue = toComparableValue(b, sortKey);
		const compare = aValue.localeCompare(bValue);
		return sortDirection === 'asc' ? compare : -compare;
	});

  $: if (!open) {
    resetModalState();
  }

  $: if (typeof document !== 'undefined') {
    document.body.classList.toggle('team-modal-open', open);
  }

  $: if (open) {
    activeSection;
    usersViewMode;
    sortedUsers.length;
    tick().then(() => {
      updateCustomScrollbar();
      requestAnimationFrame(updateCustomScrollbar);
    });
  }

  $: if (!open) {
    stopDragging();
  }

  onDestroy(() => {
		if (addUserSearchTimer) {
			clearTimeout(addUserSearchTimer);
		}
    stopDragging();
    if (typeof document !== 'undefined') {
			document.removeEventListener('mousedown', onDocumentMouseDown);
      document.body.classList.remove('team-modal-open');
      if (!document.body.dataset.scrollbarDragCount) {
        document.body.classList.remove('scrollbar-dragging');
      }
    }
  });

	onMount(() => {
		document.addEventListener('mousedown', onDocumentMouseDown);
		return () => {
			document.removeEventListener('mousedown', onDocumentMouseDown);
		};
	});
</script>

<svelte:window on:keydown={handleWindowKeydown} />

{#if open}
	<div class="teamSetupBackdrop" role="presentation" on:mousedown={handleBackdropMouseDown}>
		<div
      class="teamSetupModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-setup-title"
    >
      <div class="teamSetupModalScroll" bind:this={modalScrollEl} on:scroll={onModalScroll}>
			  <header class="teamSetupHeader">
				  <div>
					  <h2 id="team-setup-title">Team Setup</h2>
					  <p>Manage schedule users, shifts, and assignments.</p>
				  </div>
				  <button class="btn" type="button" on:click={closeModal}>Close</button>
			  </header>

			  <div class="teamSetupBody">
				  <nav class="teamSetupNav" aria-label="Team setup sections">
						{#each sections as section}
							<button
								type="button"
							class={`teamSetupNavBtn${activeSection === section.id ? ' active' : ''}`}
							on:click={() => setSection(section.id)}
						>
							{section.label}
						</button>
					{/each}
				</nav>

				<div class="teamSetupPanel">
					{#if activeSection === 'users'}
						<section class="setupSection">
							<div class="usersPaneHeader">
								<h3>Users</h3>
								{#if usersViewMode === 'list'}
									<button
										type="button"
										class="iconSquareBtn"
										aria-label="Add user"
										title="Add user"
										on:click={openAddUserView}
									>
										<svg viewBox="0 0 24 24" aria-hidden="true">
											<path d="M12 5v14M5 12h14" />
										</svg>
									</button>
								{/if}
							</div>

							{#if usersViewMode === 'list'}
								<div class="setupCard">
									<div class="tableWrap">
										<table class="setupTable">
											<thead>
												<tr>
													<th aria-sort={ariaSortFor('name')}>
														<button
															type="button"
															class="tableSortBtn"
															on:click={() => toggleSort('name')}
														>
															User
															<span
																class={`sortIndicator${sortKey === 'name' ? ' active' : ''}`}
																aria-hidden="true"
															>
																{sortKey === 'name' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
															</span>
														</button>
													</th>
													<th aria-sort={ariaSortFor('email')}>
														<button
															type="button"
															class="tableSortBtn"
															on:click={() => toggleSort('email')}
														>
															Email
															<span
																class={`sortIndicator${sortKey === 'email' ? ' active' : ''}`}
																aria-hidden="true"
															>
																{sortKey === 'email' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
															</span>
														</button>
													</th>
													<th aria-sort={ariaSortFor('role')}>
														<button
															type="button"
															class="tableSortBtn"
															on:click={() => toggleSort('role')}
														>
															Role
															<span
																class={`sortIndicator${sortKey === 'role' ? ' active' : ''}`}
																aria-hidden="true"
															>
																{sortKey === 'role' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
															</span>
														</button>
													</th>
													<th></th>
												</tr>
											</thead>
											<tbody>
												{#each sortedUsers as user}
													<tr>
														<td>{user.name}</td>
														<td>{user.email}</td>
														<td>{user.role}</td>
														<td
															><button
																type="button"
																class="btn"
																on:click={() => openEditUserView(user)}>Edit</button
															></td
														>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								</div>
							{:else if usersViewMode === 'add'}
								<div class="setupCard">
									<h4>Add User</h4>
										<div class="setupGrid">
											<label>
												<span class="srOnly">User search</span>
												<div
													class="setupUserCombo"
													role="combobox"
													aria-expanded={showAddUserResults}
													bind:this={addUserComboEl}
												>
													<input
														class="input"
														placeholder="Search by name or email"
														aria-label="User search"
														type="text"
														value={addUserQuery}
														on:input={onAddUserQueryInput}
														on:focus={onAddUserFocus}
														aria-autocomplete="list"
														aria-controls="add-user-results"
													/>
													{#if showAddUserResults}
														<div id="add-user-results" class="setupUserComboList" role="listbox">
															{#if addUsersLoading}
																<div class="setupUserComboItem setupUserComboStatus">Loading...</div>
															{:else if addUsersError}
																<div class="setupUserComboItem setupUserComboError">{addUsersError}</div>
															{:else if addUsers.length === 0}
																<button
																	class="setupUserComboItem setupUserComboStatus"
																	type="button"
																	on:mousedown|preventDefault={closeAddUserResults}
																>
																	No matches
																</button>
															{:else}
																{#each addUsers as user}
																	<button
																		class="setupUserComboItem"
																		role="option"
																		type="button"
																		on:mousedown|preventDefault={() => onAddUserSelect(user)}
																	>
																		{userLabel(user)}
																	</button>
																{/each}
															{/if}
														</div>
													{/if}
												</div>
											</label>

										<fieldset class="roleFieldset">
											<legend>Access Level</legend>
											<label>
												<input
													type="radio"
													name="access-level-add"
													value="Member"
													bind:group={selectedAddRole}
												/>
												Member
											</label>
											<label>
												<input
													type="radio"
													name="access-level-add"
													value="Maintainer"
													bind:group={selectedAddRole}
												/>
												Maintainer
											</label>
											{#if canAssignManagerRole}
												<label>
													<input
														type="radio"
														name="access-level-add"
														value="Manager"
														bind:group={selectedAddRole}
													/>
													Manager
												</label>
											{/if}
										</fieldset>
									</div>
									<div class="setupActions">
										<button type="button" class="iconActionBtn actionBtn" on:click={resetUsersPane}>
											<svg viewBox="0 0 24 24" aria-hidden="true">
												<path d="M6 6l12 12M18 6L6 18" />
											</svg>
											Cancel
										</button>
										<button type="button" class="iconActionBtn primary actionBtn">
											<svg viewBox="0 0 24 24" aria-hidden="true" class="calendarPlusIcon">
												<path
													d="M5 6h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
												/>
												<path d="M7 3v6M15 3v6M3 11h16" />
												<path class="iconPlus" d="M18 4h6M21 1v6" />
											</svg>
											Add
										</button>
									</div>
								</div>
							{:else if selectedUserForEdit}
								<div class="setupCard">
									<h4>Edit User</h4>
									<div class="setupGrid">
										<div class="userSummaryCard" role="note" aria-label="Selected user">
											<div class="userSummaryName">{selectedUserForEdit.name}</div>
											<div class="userSummaryEmail">{selectedUserForEdit.email}</div>
										</div>

										<fieldset class="roleFieldset">
											<legend>Access Level</legend>
											<label>
												<input
													type="radio"
													name="access-level-edit"
													value="Member"
													bind:group={selectedEditRole}
												/>
												Member
											</label>
											<label>
												<input
													type="radio"
													name="access-level-edit"
													value="Maintainer"
													bind:group={selectedEditRole}
												/>
												Maintainer
											</label>
											{#if canAssignManagerRole}
												<label>
													<input
														type="radio"
														name="access-level-edit"
														value="Manager"
														bind:group={selectedEditRole}
													/>
													Manager
												</label>
											{/if}
										</fieldset>
									</div>

									<div class="setupActions">
										<button
											type="button"
											class="iconActionBtn danger actionBtn"
											on:click={resetUsersPane}
										>
											<svg viewBox="0 0 24 24" aria-hidden="true">
												<path d="M4 7h16M9 7V5h6v2M9 10v8M15 10v8M7 7l1 13h8l1-13" />
											</svg>
											Remove
										</button>
										<button type="button" class="iconActionBtn actionBtn" on:click={resetUsersPane}>
											<svg viewBox="0 0 24 24" aria-hidden="true">
												<path d="M6 6l12 12M18 6L6 18" />
											</svg>
											Cancel
										</button>
										<button type="button" class="iconActionBtn primary actionBtn">
											<svg viewBox="0 0 24 24" aria-hidden="true">
												<path d="M4 12l5 5 11-11" />
											</svg>
											Save
										</button>
									</div>
								</div>
							{/if}
						</section>
					{:else if activeSection === 'shifts'}
						<section class="setupSection">
							<h3>Shifts</h3>
							<p>Define shifts and attach regular pattern behavior.</p>

							<div class="setupCard">
								<h4>Configured Shifts</h4>
								<table class="setupTable">
									<thead>
										<tr>
											<th>Shift</th>
											<th>Pattern</th>
											<th>Start</th>
											<th></th>
										</tr>
									</thead>
									<tbody>
										{#each stubShifts as shift}
											<tr>
												<td>{shift.name}</td>
												<td>{shift.pattern}</td>
												<td>{shift.start}</td>
												<td><button type="button" class="btn">Edit</button></td>
											</tr>
										{/each}
									</tbody>
								</table>
								<div class="setupActions">
									<button type="button" class="btn primary">Add Shift</button>
								</div>
							</div>
						</section>
					{:else}
						<section class="setupSection">
							<h3>Assignments</h3>
							<p>Assign Members and Maintainers to configured shifts.</p>

							<div class="setupCard">
								<h4>Current Assignments</h4>
								<table class="setupTable">
									<thead>
										<tr>
											<th>User</th>
											<th>Shift</th>
											<th></th>
										</tr>
									</thead>
									<tbody>
										{#each stubAssignments as assignment}
											<tr>
												<td>{assignment.user}</td>
												<td>{assignment.shift}</td>
												<td><button type="button" class="btn">Change</button></td>
											</tr>
										{/each}
									</tbody>
								</table>
								<div class="setupActions">
									<button type="button" class="btn primary">Create Assignment</button>
								</div>
							</div>
						</section>
					{/if}
					</div>
				</div>
      </div>
      {#if showCustomScrollbar}
        <div
          class="teamSetupScrollRail"
          role="presentation"
          aria-hidden="true"
          bind:this={railEl}
          on:mousedown={handleRailClick}
        >
          <div
            class="teamSetupScrollThumb"
            class:dragging={isDraggingScrollbar}
            role="presentation"
            style={`height:${thumbHeightPx}px;transform:translateY(${thumbTopPx}px);`}
            on:mousedown={startThumbDrag}
          ></div>
        </div>
      {/if}
		</div>
	</div>
	{/if}
