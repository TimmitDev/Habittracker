(function () {
  const STORAGE_KEY = "pulse-habit-state-v1";
  const LEGACY_DEVICE_STORAGE_KEY = "pulse-habit-device-v1";
  const SEEDED_HABIT_NAMES = ["Morning stretch", "Read 20 min", "Hydration"];
  const COMPOSER_COLORS = [
    { value: "from-orange-500 to-amber-300", label: "Sunrise", swatch: "from-orange-400 to-amber-300" },
    { value: "from-teal-600 to-emerald-400", label: "Ocean", swatch: "from-teal-500 to-emerald-400" },
    { value: "from-fuchsia-500 to-pink-300", label: "Bloom", swatch: "from-fuchsia-500 to-pink-400" },
    { value: "from-sky-500 to-cyan-300", label: "Sky", swatch: "from-sky-500 to-cyan-300" },
  ];
  const COMPOSER_TARGETS = [3, 4, 5, 7];
  const COMPOSER_PRESETS = [
    { label: "Stretch", name: "Morning stretch", color: "from-orange-500 to-amber-300", targetPerWeek: 4 },
    { label: "Read", name: "Read 20 min", color: "from-teal-600 to-emerald-400", targetPerWeek: 5 },
    { label: "Walk", name: "Walk 5k", color: "from-sky-500 to-cyan-300", targetPerWeek: 4 },
    { label: "Water", name: "Hydration", color: "from-fuchsia-500 to-pink-300", targetPerWeek: 7 },
  ];

  const config = window.HabitTrackerConfig || {};
  const page = document.body.dataset.page || "main";
  const shell = document.getElementById("app-shell");
  let serviceWorkerRegistration = null;
  let isHabitComposerOpen = false;
  let selectedDayKey = todayKey();
  let resultsMonthOffset = 0;
  let composerDraft = buildDefaultComposerDraft();

  const DEFAULT_STATE = buildDefaultState();

  function buildDefaultComposerDraft() {
    return {
      name: "",
      color: COMPOSER_COLORS[0].value,
      targetPerWeek: 4,
    };
  }

  function resetComposerDraft() {
    composerDraft = buildDefaultComposerDraft();
  }

  function createHabit(name, color, target, completedDays) {
    const completions = {};
    completedDays.forEach(function (day) {
      completions[day] = true;
    });

    return {
      id: uid(),
      name: name,
      color: color,
      targetPerWeek: target,
      completions: completions,
      createdAt: new Date().toISOString(),
    };
  }

  function createActivity(type, message, actor, at) {
    return {
      id: uid(),
      type: type,
      message: message,
      actor: actor,
      at: at || new Date().toISOString(),
    };
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function buildDefaultState() {
    return {
      updatedAt: new Date().toISOString(),
      migrations: {
        seedHabitsRemoved: true,
        singleLocalMode: true,
      },
      profile: {
        name: "Walt",
        avatar: "W",
        dailyReminder: "20:00",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Amsterdam",
        mood: "On fire",
        headline: "Ik bouw momentum, niet perfectie.",
      },
      habits: [],
      activity: [createActivity("welcome", "Voeg je eerste habit toe met de plusknop", "System", offsetTimestamp(-25))],
      social: {
        teamCode: "PULSE-4821",
        storageStatus: "Alles staat lokaal op dit toestel.",
        lastSavedAt: null,
      },
      notifications: {
        permission: typeof Notification !== "undefined" ? Notification.permission : "unsupported",
        lastSubscriptionAt: null,
      },
    };
  }

  function cloneState(value) {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
  }

  function offsetTimestamp(minutes) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return date.toISOString();
  }

  function dateKeyFromLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function dateFromKey(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function offsetDayKey(offsetDays) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offsetDays);
    return dateKeyFromLocal(date);
  }

  function todayKey() {
    return dateKeyFromLocal(new Date());
  }

  function getResultsReferenceDate() {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(1);
    date.setMonth(date.getMonth() + resultsMonthOffset);
    return date;
  }

  function formatDay(dateKey, options) {
    return new Intl.DateTimeFormat("nl-NL", options || { day: "numeric", month: "short" }).format(dateFromKey(dateKey));
  }

  function getLastNDates(count) {
    const dates = [];
    const date = new Date();
    date.setHours(12, 0, 0, 0);

    for (let index = count - 1; index >= 0; index -= 1) {
      const next = new Date(date);
      next.setDate(date.getDate() - index);
      dates.push(dateKeyFromLocal(next));
    }

    return dates;
  }

  function getState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_STATE));
        return cloneState(DEFAULT_STATE);
      }

      const parsed = JSON.parse(raw);
      const migration = migrateStoredState(parsed);
      const merged = mergeState(DEFAULT_STATE, migration.state);

      if (migration.changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeStateForStorage(merged)));
      }

      return merged;
    } catch (error) {
      console.warn("Kon lokale state niet laden.", error);
      return cloneState(DEFAULT_STATE);
    }
  }

  function migrateStoredState(state) {
    if (Array.isArray(state && state.profiles)) {
      return {
        state: flattenLegacyProfilesState(state),
        changed: true,
      };
    }

    const nextState = cloneState(state || {});
    let changed = false;

    if (!nextState.migrations || !nextState.migrations.seedHabitsRemoved) {
      const habits = Array.isArray(nextState.habits) ? nextState.habits : [];
      const activity = Array.isArray(nextState.activity) ? nextState.activity : [];

      nextState.habits = habits.filter(function (habit) {
        return !isSeededHabit(habit);
      });
      nextState.activity = activity.filter(function (event) {
        return !isSeededActivity(event);
      });
      nextState.migrations = {
        ...(nextState.migrations || {}),
        seedHabitsRemoved: true,
      };
      changed = true;
    }

    if (!nextState.migrations || !nextState.migrations.singleLocalMode) {
      nextState.migrations = {
        ...(nextState.migrations || {}),
        singleLocalMode: true,
      };
      changed = true;
    }

    return {
      state: mergeState(DEFAULT_STATE, nextState),
      changed: changed,
    };
  }

  function flattenLegacyProfilesState(state) {
    const activeProfileId = readLegacyActiveProfileId();
    const notifications = readLegacyNotifications(state);
    const profiles = Array.isArray(state.profiles) ? state.profiles : [];
    const selectedProfile =
      profiles.find(function (profile) {
        return profile.id === activeProfileId;
      }) || profiles[0] || {};

    try {
      localStorage.removeItem(LEGACY_DEVICE_STORAGE_KEY);
    } catch (error) {
      console.warn("Kon legacy device state niet opruimen.", error);
    }

    return mergeState(DEFAULT_STATE, {
      updatedAt: state.updatedAt || new Date().toISOString(),
      migrations: {
        ...(state.migrations || {}),
        seedHabitsRemoved: true,
        singleLocalMode: true,
      },
      profile: {
        ...DEFAULT_STATE.profile,
        name: selectedProfile.name || DEFAULT_STATE.profile.name,
        avatar:
          selectedProfile.avatar ||
          (selectedProfile.name ? selectedProfile.name.slice(0, 1).toUpperCase() : DEFAULT_STATE.profile.avatar),
        dailyReminder: selectedProfile.dailyReminder || DEFAULT_STATE.profile.dailyReminder,
        timezone: selectedProfile.timezone || DEFAULT_STATE.profile.timezone,
        mood: selectedProfile.mood || DEFAULT_STATE.profile.mood,
        headline: selectedProfile.headline || DEFAULT_STATE.profile.headline,
      },
      habits: Array.isArray(selectedProfile.habits) ? selectedProfile.habits : [],
      activity: Array.isArray(selectedProfile.activity) ? selectedProfile.activity : [],
      social: {
        ...(state.social || {}),
        storageStatus: "Alles staat lokaal op dit toestel.",
      },
      notifications: notifications,
    });
  }

  function readLegacyActiveProfileId() {
    try {
      const raw = localStorage.getItem(LEGACY_DEVICE_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      return parsed.activeProfileId || null;
    } catch (error) {
      return null;
    }
  }

  function readLegacyNotifications(state) {
    try {
      const raw = localStorage.getItem(LEGACY_DEVICE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.notifications) {
          return {
            ...DEFAULT_STATE.notifications,
            ...parsed.notifications,
          };
        }
      }
    } catch (error) {
      console.warn("Kon legacy notificaties niet lezen.", error);
    }

    return {
      ...DEFAULT_STATE.notifications,
      ...((state && state.notifications) || {}),
    };
  }

  function isSeededHabit(habit) {
    if (!habit || typeof habit.name !== "string") {
      return false;
    }

    return SEEDED_HABIT_NAMES.includes(habit.name.trim());
  }

  function isSeededActivity(event) {
    const message = event && typeof event.message === "string" ? event.message : "";

    return SEEDED_HABIT_NAMES.some(function (habitName) {
      return message.includes(habitName);
    });
  }

  function normalizeStateForStorage(state) {
    return {
      updatedAt: state.updatedAt || new Date().toISOString(),
      migrations: {
        ...(DEFAULT_STATE.migrations || {}),
        ...(state.migrations || {}),
      },
      profile: {
        ...(DEFAULT_STATE.profile || {}),
        ...(state.profile || {}),
      },
      habits: Array.isArray(state.habits) ? state.habits : [],
      activity: Array.isArray(state.activity) ? state.activity : [],
      social: {
        ...(DEFAULT_STATE.social || {}),
        ...(state.social || {}),
      },
      notifications: {
        ...(DEFAULT_STATE.notifications || {}),
        ...(state.notifications || {}),
      },
    };
  }

  function mergeState(base, incoming) {
    return {
      ...base,
      ...incoming,
      migrations: { ...(base.migrations || {}), ...((incoming && incoming.migrations) || {}) },
      profile: { ...(base.profile || {}), ...((incoming && incoming.profile) || {}) },
      social: { ...(base.social || {}), ...((incoming && incoming.social) || {}) },
      notifications: { ...(base.notifications || {}), ...((incoming && incoming.notifications) || {}) },
      habits: Array.isArray(incoming && incoming.habits) ? incoming.habits : base.habits,
      activity: Array.isArray(incoming && incoming.activity) ? incoming.activity : base.activity,
    };
  }

  function setState(nextState) {
    nextState.updatedAt = new Date().toISOString();
    nextState.social = {
      ...(nextState.social || {}),
      lastSavedAt: nextState.updatedAt,
      storageStatus: "Alles staat lokaal op dit toestel.",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeStateForStorage(nextState)));
  }

  function getHabitStats(habit, selectedDay, weekDates) {
    const dates = Object.keys(habit.completions || {}).filter(function (day) {
      return habit.completions[day];
    });
    const week = weekDates || getLastNDates(7);
    const completedThisWeek = week.filter(function (day) {
      return Boolean(habit.completions[day]);
    }).length;

    let streak = 0;
    const date = new Date();
    date.setHours(12, 0, 0, 0);

    while (true) {
      const key = dateKeyFromLocal(date);
      if (!habit.completions[key]) {
        break;
      }

      streak += 1;
      date.setDate(date.getDate() - 1);
    }

    return {
      completedToday: Boolean(habit.completions[todayKey()]),
      completedOnSelectedDay: Boolean(habit.completions[selectedDay || todayKey()]),
      completedThisWeek: completedThisWeek,
      streak: streak,
      totalCompletions: dates.length,
      targetPerWeek: habit.targetPerWeek || 1,
    };
  }

  function getOverview(state) {
    const weekDates = getLastNDates(7);
    const mainSelectedDayKey = weekDates.includes(selectedDayKey) ? selectedDayKey : weekDates[weekDates.length - 1];

    const habits = state.habits.map(function (habit) {
      return {
        ...habit,
        stats: getHabitStats(habit, mainSelectedDayKey, weekDates),
      };
    });
    const completedToday = habits.filter(function (habit) {
      return habit.stats.completedToday;
    }).length;
    const completedOnSelectedDay = habits.filter(function (habit) {
      return habit.stats.completedOnSelectedDay;
    }).length;
    const bestStreak = habits.reduce(function (max, habit) {
      return Math.max(max, habit.stats.streak);
    }, 0);
    const weeklyCompletions = habits.reduce(function (sum, habit) {
      return sum + habit.stats.completedThisWeek;
    }, 0);

    return {
      habits: habits,
      weekDates: weekDates,
      selectedDayKey: mainSelectedDayKey,
      resultsSelectedDayKey: selectedDayKey,
      completedToday: completedToday,
      completedOnSelectedDay: completedOnSelectedDay,
      totalHabits: habits.length,
      bestStreak: bestStreak,
      weeklyCompletions: weeklyCompletions,
    };
  }

  function formatHeaderDate() {
    return new Intl.DateTimeFormat("nl-NL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date());
  }

  function renderApp() {
    const state = getState();
    const overview = getOverview(state);
    const isMainPage = page === "main";
    const isResultsPage = page === "activity";
    shell.innerHTML = `
      <div class="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col safe-top safe-bottom">
        ${isResultsPage ? "" : `<header class="${isMainPage ? "px-5 pb-2" : "px-5 pb-4"}">${renderHeader(state, overview)}</header>`}
        <main class="${isMainPage ? "flex-1 overflow-hidden px-5 pb-28" : isResultsPage ? "flex-1 px-5 pb-28 pt-4" : "flex-1 px-5 pb-28"}">
          ${renderPage(state, overview)}
        </main>
        <nav class="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-5 safe-bottom">
          ${renderNav(page)}
        </nav>
      </div>
    `;
    bindEvents();
  }

  function renderHeader(state, overview) {
    const headerControl =
      page === "main"
        ? `
          <button data-action="toggle-habit-form" class="flex h-14 w-14 items-center justify-center rounded-[1.35rem] bg-gradient-to-br from-iosblue to-[#3ac8ff] text-white shadow-ios transition hover:scale-[1.03]">
            ${addIcon()}
            <span class="sr-only">Nieuwe habit toevoegen</span>
          </button>
        `
        : `
          <div class="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/80 bg-white/72 text-lg font-semibold text-iosblue shadow-glass backdrop-blur-2xl">
            ${escapeHtml(state.profile.avatar)}
            <span class="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full border-2 border-white bg-iosgreen"></span>
          </div>
        `;

    if (page === "main") {
      return `
        <div class="flex justify-end px-1 pt-1">
          ${headerControl}
        </div>
      `;
    }

    return `
      <div class="px-1">
        <p class="text-sm font-semibold capitalize text-slate-500">${formatHeaderDate()}</p>
        <div class="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 class="text-[2.35rem] font-bold leading-none tracking-tight text-slate-900">${pageTitle(page)}</h1>
            <p class="mt-2 max-w-xs text-[15px] leading-6 text-slate-500">${escapeHtml(state.profile.headline)}</p>
          </div>
          ${headerControl}
        </div>
        <div class="mt-4 flex flex-wrap gap-2 text-sm">
          <span class="rounded-full border border-white/80 bg-white/72 px-3 py-1 font-medium text-iosblue shadow-glass backdrop-blur-2xl">${overview.completedToday}/${overview.totalHabits} vandaag</span>
          <span class="rounded-full border border-white/80 bg-white/72 px-3 py-1 font-medium text-iosgreen shadow-glass backdrop-blur-2xl">${overview.bestStreak} dagen streak</span>
          <span class="rounded-full border border-white/80 bg-white/72 px-3 py-1 font-medium text-slate-500 shadow-glass backdrop-blur-2xl">Lokaal</span>
        </div>
      </div>
    `;
  }

  function renderPage(state, overview) {
    if (page === "activity") {
      return renderActivityPage(state, overview);
    }

    return renderMainPage(state, overview);
  }

  function renderMainPage(state, overview) {
    return `
      <section class="h-full">
        ${renderComposer()}
        <div class="flex h-full flex-col gap-3">
          ${renderDayPicker(overview)}
          <section class="flex flex-1 flex-col gap-3 overflow-y-auto">
            ${overview.habits
              .map(function (habit) {
                return renderHabitCard(habit, overview);
              })
              .join("")}
          </section>
        </div>
      </section>
    `;
  }

  function renderComposer() {
    if (!isHabitComposerOpen) {
      return "";
    }

    return `
      <div data-action="close-composer-backdrop" class="fixed inset-0 z-30 bg-white/60 backdrop-blur-md">
        <div class="mx-auto flex h-full max-w-md items-end px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)] pt-3 sm:px-5">
          <section class="flex max-h-[calc(100vh_-_0.75rem)] w-full flex-col overflow-hidden rounded-[2rem] border border-white/85 bg-white/95 shadow-glass backdrop-blur-2xl">
            <div class="shrink-0 px-5 pt-3">
              <div class="mx-auto mb-4 h-1.5 w-14 rounded-full bg-slate-200"></div>
            </div>
            <div class="shrink-0 border-b border-slate-100/90 px-5 pb-4">
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-xs font-semibold uppercase tracking-[0.18em] text-iosblue">New habit</p>
                  <h2 class="mt-2 text-[1.65rem] font-bold leading-8 tracking-tight text-slate-900">Maak iets waar je echt op terug wilt komen</h2>
                  <p class="mt-2 text-sm leading-6 text-slate-500">Alles past nu comfortabel op mobiel, ook met kleine schermen en open toetsenbord.</p>
                </div>
                <button data-action="toggle-habit-form" class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200">
                  ${closeIcon()}
                  <span class="sr-only">Sluit</span>
                </button>
              </div>
            </div>
            <form id="habit-form" class="flex min-h-0 flex-1 flex-col">
              <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                <section class="rounded-[1.5rem] bg-slate-50/90 p-4">
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-sm font-semibold text-slate-900">Quick start</p>
                    <p class="text-xs font-medium text-slate-400">1 tap</p>
                  </div>
                  <div class="mt-3 grid grid-cols-2 gap-2">
                    ${COMPOSER_PRESETS.map(renderComposerPreset).join("")}
                  </div>
                </section>
                <div class="mt-4">
                  <div class="mb-2 flex items-center justify-between gap-3">
                    <label for="habit-name" class="text-sm font-semibold text-slate-900">Habit name</label>
                    <span data-role="composer-count" class="text-xs font-medium text-slate-400">${composerDraft.name.length}/24</span>
                  </div>
                  <input id="habit-name" type="text" maxlength="24" value="${escapeHtml(composerDraft.name)}" placeholder="Bijv. Walk 5k" class="w-full rounded-[1.35rem] border border-white/80 bg-white px-4 py-3.5 text-base outline-none ring-0 transition focus:border-iosblue focus:bg-white" required />
                </div>
                <div class="mt-4">
                  <p class="mb-2 text-sm font-semibold text-slate-900">Kleur</p>
                  <div class="grid grid-cols-2 gap-2">
                    ${COMPOSER_COLORS.map(renderComposerColorOption).join("")}
                  </div>
                </div>
                <div class="mt-4">
                  <p class="mb-2 text-sm font-semibold text-slate-900">Per week</p>
                  <div class="grid grid-cols-4 gap-2">
                    ${COMPOSER_TARGETS.map(renderComposerTargetOption).join("")}
                  </div>
                </div>
                <div class="mt-4 rounded-[1.5rem] bg-slate-50/90 p-4">
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <p data-role="composer-preview-name" class="truncate text-sm font-semibold text-slate-900">${composerDraft.name ? escapeHtml(composerDraft.name) : "Nieuwe habit"}</p>
                      <p class="mt-1 text-xs text-slate-500">${composerDraft.targetPerWeek} keer per week</p>
                    </div>
                    <span class="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm">${findComposerColor(composerDraft.color).label}</span>
                  </div>
                </div>
              </div>
              <div class="shrink-0 border-t border-slate-100/90 bg-white/96 px-5 pb-[calc(env(safe-area-inset-bottom)_+_0.35rem)] pt-4 backdrop-blur-xl">
                <button type="submit" class="w-full rounded-[1.35rem] bg-iosblue px-4 py-4 text-sm font-semibold text-white shadow-ios transition hover:bg-[#006de0]">Habit toevoegen</button>
              </div>
            </form>
          </section>
        </div>
      </div>
    `;
  }

  function renderComposerPreset(preset) {
    return `
      <button
        type="button"
        data-action="composer-preset"
        data-name="${escapeHtml(preset.name)}"
        data-color="${preset.color}"
        data-target="${preset.targetPerWeek}"
        class="rounded-[1.15rem] border border-white bg-white px-3 py-3 text-left text-sm font-semibold text-slate-600 shadow-sm transition hover:border-iosblue/25 hover:text-iosblue"
      >
        ${escapeHtml(preset.label)}
      </button>
    `;
  }

  function renderComposerColorOption(option) {
    const active = composerDraft.color === option.value;

    return `
      <button
        type="button"
        data-action="composer-color"
        data-color="${option.value}"
        class="rounded-[1.25rem] border px-3 py-3 text-center transition ${active ? "border-iosblue/30 bg-iosblue/8" : "border-white/80 bg-slate-50/80 hover:bg-white"}"
      >
        <span class="mx-auto block h-9 w-9 rounded-full bg-gradient-to-br ${option.swatch} shadow-sm"></span>
        <span class="mt-2 block text-[11px] font-semibold ${active ? "text-iosblue" : "text-slate-500"}">${option.label}</span>
      </button>
    `;
  }

  function renderComposerTargetOption(target) {
    const active = composerDraft.targetPerWeek === target;

    return `
      <button
        type="button"
        data-action="composer-target"
        data-target="${target}"
        class="rounded-[1.25rem] border px-3 py-3.5 text-center text-sm font-semibold transition ${active ? "border-iosblue/30 bg-iosblue/8 text-iosblue" : "border-white/80 bg-slate-50/80 text-slate-500 hover:bg-white"}"
      >
        ${target}x
      </button>
    `;
  }

  function renderDayPicker(overview) {
    return `
      <section class="rounded-[1.35rem] border border-white/80 bg-white/72 p-1.5 shadow-glass backdrop-blur-2xl">
        <div class="grid grid-cols-7 gap-1">
          ${overview.weekDates
            .map(function (day) {
              const isActive = day === overview.selectedDayKey;
              const completedCount = overview.habits.filter(function (habit) {
                return Boolean(habit.completions[day]);
              }).length;

              return `
                <button
                  type="button"
                  data-action="select-day"
                  data-day-key="${day}"
                  class="flex flex-col items-center justify-center gap-1 rounded-[1rem] px-1 py-2 text-center transition ${isActive ? "bg-iosblue/12 text-iosblue" : "text-slate-500 hover:bg-slate-100/80"}"
                >
                  <span class="text-[10px] font-semibold uppercase tracking-[0.14em]">${formatDay(day, { weekday: "narrow" }).slice(0, 1)}</span>
                  <span class="text-sm font-semibold">${formatDay(day, { day: "numeric" })}</span>
                  <span class="h-1.5 w-1.5 rounded-full ${completedCount > 0 ? "bg-emerald-400" : "bg-slate-200"}"></span>
                </button>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  function renderHabitCard(habit, overview) {
    const week = overview.weekDates;
    const safeName = escapeHtml(habit.name);
    const completedLabel = habit.stats.completedOnSelectedDay ? "Voltooid" : "Markeer";
    const icon = getHabitIcon(habit.name);
    const weekBlocks = week
      .map(function (day) {
        const isFilled = Boolean(habit.completions[day]);
        const isSelectedDay = day === overview.selectedDayKey;
        let blockClasses = "bg-slate-200/85";

        if (isFilled && isSelectedDay) {
          blockClasses = "bg-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.18),0_8px_16px_rgba(34,197,94,0.18)]";
        } else if (isFilled) {
          blockClasses = "bg-emerald-400/95";
        } else if (isSelectedDay) {
          blockClasses = "border border-iosblue/35 bg-white";
        }

        return `<span class="aspect-square rounded-[0.32rem] ${blockClasses}"></span>`;
      })
      .join("");

    return `
      <button type="button" data-action="toggle-habit" data-habit-id="${habit.id}" class="group w-full overflow-hidden rounded-[1.6rem] border border-white/80 bg-white/76 px-4 py-3.5 text-left shadow-glass backdrop-blur-2xl transition hover:-translate-y-0.5 hover:bg-white/82 ${habit.stats.completedOnSelectedDay ? "ring-2 ring-iosgreen/25" : ""}">
        <div class="flex items-center gap-3">
          <span class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.1rem] bg-gradient-to-br ${habit.color} text-white shadow-sm">
            ${icon}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-3">
              <h3 class="truncate text-base font-semibold text-slate-900">${safeName}</h3>
              <span class="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${habit.stats.completedOnSelectedDay ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}">
                ${habit.stats.completedOnSelectedDay ? "Done" : "Open"}
              </span>
            </div>
            <div class="mt-2 grid grid-cols-7 gap-1.5">
              ${weekBlocks}
            </div>
            <div class="mt-2 flex items-center justify-between text-[11px] font-medium text-slate-400">
              <span>${habit.targetPerWeek}x per week</span>
              <span>${habit.stats.streak}d streak</span>
            </div>
          </div>
          <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${habit.stats.completedOnSelectedDay ? "bg-emerald-500 text-white shadow-[0_10px_18px_rgba(34,197,94,0.18)]" : "bg-slate-100 text-slate-400"}">
            ${habit.stats.completedOnSelectedDay ? checkIcon() : chevronIcon("right")}
          </span>
        </div>
        <span class="sr-only">${completedLabel}</span>
      </button>
    `;
  }

  function getMonthGrid(referenceDate) {
    const reference = referenceDate ? new Date(referenceDate) : new Date();
    reference.setHours(12, 0, 0, 0);

    const monthStart = new Date(reference.getFullYear(), reference.getMonth(), 1, 12);
    const monthEnd = new Date(reference.getFullYear(), reference.getMonth() + 1, 0, 12);
    const calendarStart = new Date(monthStart);
    const calendarEnd = new Date(monthEnd);

    calendarStart.setDate(calendarStart.getDate() - ((calendarStart.getDay() + 6) % 7));
    calendarEnd.setDate(calendarEnd.getDate() + (6 - ((calendarEnd.getDay() + 6) % 7)));

    const weeks = [];
    let week = [];
    const cursor = new Date(calendarStart);

    while (cursor <= calendarEnd) {
      week.push(dateKeyFromLocal(cursor));
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      monthLabel: new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" }).format(monthStart),
      monthStartKey: dateKeyFromLocal(monthStart),
      monthEndKey: dateKeyFromLocal(monthEnd),
      weeks: weeks,
    };
  }

  function isMonthDay(dayKey, monthGrid) {
    return dayKey >= monthGrid.monthStartKey && dayKey <= monthGrid.monthEndKey;
  }

  function getDayResult(dayKey, habits) {
    const totalHabits = habits.length;
    const completedCount = habits.filter(function (habit) {
      return Boolean(habit.completions[dayKey]);
    }).length;

    return {
      totalHabits: totalHabits,
      completedCount: completedCount,
      allHabitsDone: totalHabits > 0 && completedCount === totalHabits,
      ratio: totalHabits === 0 ? 0 : completedCount / totalHabits,
    };
  }

  function getSelectedDayStatus(dayKey, habits) {
    const summary = getDayResult(dayKey, habits);

    if (!summary.totalHabits) {
      return "Nog geen habits";
    }

    if (summary.allHabitsDone) {
      return "Alles behaald";
    }

    if (!summary.completedCount) {
      return "Niets gedaan";
    }

    return summary.completedCount + "/" + summary.totalHabits + " behaald";
  }

  function renderMonthWeek(week, monthGrid, habits) {
    return `
      <div class="grid grid-cols-7 gap-1.5">
        ${week
          .map(function (dayKey) {
            return renderMonthCell(dayKey, monthGrid, habits);
          })
          .join("")}
      </div>
    `;
  }

  function renderMonthCell(dayKey, monthGrid, habits) {
    const isCurrentMonth = isMonthDay(dayKey, monthGrid);
    const summary = getDayResult(dayKey, habits);
    const isToday = dayKey === todayKey();
    const isSelectedDay = dayKey === selectedDayKey;
    const dayNumber = formatDay(dayKey, { day: "numeric" });
    let classes = "border border-slate-200 bg-white text-slate-500";

    if (!isCurrentMonth) {
      classes = "border border-slate-100 bg-slate-50/80 text-slate-300";
    } else if (summary.allHabitsDone) {
      classes = "bg-emerald-500 text-white shadow-[0_10px_22px_rgba(34,197,94,0.20)]";
    } else if (summary.ratio >= 0.66) {
      classes = "bg-emerald-300 text-emerald-950";
    } else if (summary.ratio >= 0.33) {
      classes = "bg-emerald-200 text-emerald-900";
    } else if (summary.ratio > 0) {
      classes = "bg-emerald-100 text-emerald-800";
    }

    let ringClasses = "";
    if (isToday) {
      ringClasses += " ring-1 ring-slate-300";
    }
    if (isSelectedDay && isCurrentMonth) {
      ringClasses += " ring-2 ring-iosblue/35 ring-offset-2 ring-offset-white";
    }

    const statusLabel =
      !isCurrentMonth
        ? "buiten deze maand"
        : summary.totalHabits === 0
        ? "nog geen habits"
        : summary.allHabitsDone
          ? "alle habits behaald"
          : summary.completedCount + "/" + summary.totalHabits + " habits behaald";

    return `
      <button
        type="button"
        data-action="select-day"
        data-day-key="${dayKey}"
        title="${escapeHtml(formatDay(dayKey, { weekday: "long", day: "numeric", month: "long" }) + ": " + statusLabel)}"
        class="relative flex aspect-square min-h-[3rem] w-full items-center justify-center rounded-[0.95rem] text-[11px] font-semibold transition ${classes}${ringClasses}"
      >
        <span class="absolute left-2 top-1.5 text-[10px] font-semibold ${summary.allHabitsDone ? "text-white/80" : "text-current"}">${dayNumber}</span>
        ${summary.allHabitsDone ? `<span class="absolute bottom-1.5 right-1.5">${monthCheckIcon()}</span>` : ""}
      </button>
    `;
  }

  function renderActivityPage(state, overview) {
    const monthGrid = getMonthGrid(getResultsReferenceDate());

    return `
      <section class="flex justify-center">
        <section class="w-full rounded-[1.9rem] border border-white/80 bg-white/72 p-4 shadow-glass backdrop-blur-2xl">
          <div class="mb-4 flex items-center justify-between gap-3">
            <button type="button" data-action="results-month-nav" data-direction="-1" class="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200/90 bg-white text-slate-500 transition hover:border-iosblue/25 hover:text-iosblue">
              ${chevronIcon("left")}
              <span class="sr-only">Vorige maand</span>
            </button>
            <button type="button" data-action="results-month-reset" class="min-w-0 rounded-full border border-white/80 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm transition hover:border-iosblue/20 hover:text-iosblue">
              ${escapeHtml(monthGrid.monthLabel)}
            </button>
            <button type="button" data-action="results-month-nav" data-direction="1" class="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200/90 bg-white text-slate-500 transition hover:border-iosblue/25 hover:text-iosblue">
              ${chevronIcon("right")}
              <span class="sr-only">Volgende maand</span>
            </button>
          </div>
          <div class="grid grid-cols-7 gap-1.5 pb-2 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">
            <span>ma</span>
            <span>di</span>
            <span>wo</span>
            <span>do</span>
            <span>vr</span>
            <span>za</span>
            <span>zo</span>
          </div>
          <div class="space-y-1.5">
            ${monthGrid.weeks
              .map(function (week) {
                return renderMonthWeek(week, monthGrid, overview.habits);
              })
              .join("")}
          </div>
          <div class="mt-4 flex items-center justify-between gap-3 rounded-[1.2rem] border border-slate-100 bg-white/80 px-4 py-3 text-sm text-slate-500">
            <span>${escapeHtml(formatDay(selectedDayKey, { weekday: "long", day: "numeric", month: "long" }))}</span>
            <span class="font-semibold text-slate-900">${escapeHtml(getSelectedDayStatus(selectedDayKey, overview.habits))}</span>
          </div>
        </section>
      </section>
    `;
  }

  function renderNav(currentPage) {
    const items = [
      { id: "main", label: "Main", href: "./index.html", icon: homeIcon() },
      { id: "activity", label: "Results", href: "./activity.html", icon: chartIcon() },
    ];

    return `
      <div class="ios-tabbar rounded-[1.35rem] px-1.5 py-1.5">
        <div class="grid grid-cols-2 gap-0.5">
          ${items
            .map(function (item) {
              const active = item.id === currentPage;
              return `
                <a href="${item.href}" ${active ? 'aria-current="page"' : ""} class="ios-tab-item ${active ? "active" : ""} flex flex-col items-center justify-center gap-0.5 rounded-[1rem] px-2 py-2 text-[10px] font-medium">
                  <span class="ios-tab-icon">${item.icon}</span>
                  ${item.label}
                </a>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function bindEvents() {
    document.querySelectorAll("[data-action='select-day']").forEach(function (button) {
      button.addEventListener("click", function () {
        selectDay(button.dataset.dayKey);
      });
    });

    document.querySelectorAll("[data-action='toggle-habit']").forEach(function (button) {
      button.addEventListener("click", function () {
        toggleHabit(button.dataset.habitId);
      });
    });

    document.querySelectorAll("[data-action='toggle-habit-form']").forEach(function (button) {
      button.addEventListener("click", toggleHabitComposer);
    });

    const composerBackdrop = document.querySelector("[data-action='close-composer-backdrop']");
    if (composerBackdrop) {
      composerBackdrop.addEventListener("click", function (event) {
        if (event.target === composerBackdrop) {
          toggleHabitComposer();
        }
      });
    }

    document.querySelectorAll("[data-action='composer-preset']").forEach(function (button) {
      button.addEventListener("click", function () {
        applyComposerPreset(button.dataset.name, button.dataset.color, Number(button.dataset.target));
      });
    });

    document.querySelectorAll("[data-action='composer-color']").forEach(function (button) {
      button.addEventListener("click", function () {
        selectComposerColor(button.dataset.color);
      });
    });

    document.querySelectorAll("[data-action='composer-target']").forEach(function (button) {
      button.addEventListener("click", function () {
        selectComposerTarget(Number(button.dataset.target));
      });
    });

    const habitNameInput = document.getElementById("habit-name");
    if (habitNameInput) {
      habitNameInput.addEventListener("input", function () {
        composerDraft.name = habitNameInput.value;
        const counter = document.querySelector("[data-role='composer-count']");
        const previewName = document.querySelector("[data-role='composer-preview-name']");
        if (counter) {
          counter.textContent = composerDraft.name.length + "/24";
        }
        if (previewName) {
          previewName.textContent = composerDraft.name || "Nieuwe habit";
        }
      });
    }

    const habitForm = document.getElementById("habit-form");
    if (habitForm) {
      habitForm.addEventListener("submit", function (event) {
        event.preventDefault();
        addHabit(composerDraft.name.trim(), composerDraft.color, composerDraft.targetPerWeek);
      });
    }

    document.querySelectorAll("[data-action='enable-notifications']").forEach(function (button) {
      button.addEventListener("click", enableNotifications);
    });

    document.querySelectorAll("[data-action='results-month-nav']").forEach(function (button) {
      button.addEventListener("click", function () {
        shiftResultsMonth(Number(button.dataset.direction));
      });
    });

    document.querySelectorAll("[data-action='results-month-reset']").forEach(function (button) {
      button.addEventListener("click", resetResultsMonth);
    });

    const testButton = document.querySelector("[data-action='send-test-notification']");
    if (testButton) {
      testButton.addEventListener("click", showLocalNotification);
    }
  }

  function selectDay(dayKey) {
    if (!dayKey) {
      return;
    }

    selectedDayKey = dayKey;
    renderApp();
  }

  function toggleHabit(habitId) {
    const state = getState();
    const habit = state.habits.find(function (item) {
      return item.id === habitId;
    });

    if (!habit) {
      return;
    }

    const weekDates = getLastNDates(7);
    const activeDay = page === "main" && !weekDates.includes(selectedDayKey) ? weekDates[weekDates.length - 1] : selectedDayKey;
    const completed = Boolean(habit.completions[activeDay]);
    habit.completions[activeDay] = !completed;

    if (!habit.completions[activeDay]) {
      delete habit.completions[activeDay];
    }

    const actor = state.profile.name || "You";
    const actionSuffix =
      activeDay === todayKey() ? "" : " voor " + formatDay(activeDay, { weekday: "long", day: "numeric", month: "short" });
    state.activity.unshift(
      createActivity(
        completed ? "undo" : "complete",
        completed ? habit.name + " terug opengezet" + actionSuffix : habit.name + " voltooid" + actionSuffix,
        actor
      )
    );

    if (!completed) {
      const streak = getHabitStats(habit, activeDay, getLastNDates(7)).streak;
      if (streak >= 2) {
        state.activity.unshift(createActivity("streak", habit.name + " zit nu op " + streak + " dagen streak", actor));
      }
    }

    setState(state);
    renderApp();
  }

  function toggleHabitComposer() {
    if (isHabitComposerOpen) {
      isHabitComposerOpen = false;
      resetComposerDraft();
      renderApp();
      return;
    }

    isHabitComposerOpen = true;
    resetComposerDraft();
    renderApp();
    focusComposerInput();
  }

  function shiftResultsMonth(direction) {
    if (!Number.isFinite(direction) || direction === 0) {
      return;
    }

    resultsMonthOffset += direction;
    selectedDayKey = dateKeyFromLocal(getResultsReferenceDate());
    renderApp();
  }

  function resetResultsMonth() {
    resultsMonthOffset = 0;
    selectedDayKey = todayKey();
    renderApp();
  }

  function focusComposerInput() {
    requestAnimationFrame(function () {
      const input = document.getElementById("habit-name");
      if (!input) {
        return;
      }

      input.focus();
      const length = input.value.length;
      input.setSelectionRange(length, length);
    });
  }

  function applyComposerPreset(name, color, targetPerWeek) {
    composerDraft = {
      ...composerDraft,
      name: name || composerDraft.name,
      color: color || composerDraft.color,
      targetPerWeek: targetPerWeek || composerDraft.targetPerWeek,
    };
    renderApp();
    focusComposerInput();
  }

  function selectComposerColor(color) {
    if (!color) {
      return;
    }

    composerDraft.color = color;
    renderApp();
    focusComposerInput();
  }

  function selectComposerTarget(targetPerWeek) {
    if (!targetPerWeek) {
      return;
    }

    composerDraft.targetPerWeek = targetPerWeek;
    renderApp();
    focusComposerInput();
  }

  function findComposerColor(colorValue) {
    return (
      COMPOSER_COLORS.find(function (option) {
        return option.value === colorValue;
      }) || COMPOSER_COLORS[0]
    );
  }

  function addHabit(name, color, targetPerWeek) {
    if (!name) {
      return;
    }

    const state = getState();
    const actor = state.profile.name || "You";
    state.habits.unshift(createHabit(name, color, targetPerWeek, []));
    state.activity.unshift(createActivity("habit_created", "Nieuwe habit toegevoegd: " + name, actor));
    setState(state);
    isHabitComposerOpen = false;
    resetComposerDraft();
    renderApp();
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "fixed left-1/2 top-8 z-50 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-xl";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.remove();
    }, 1800);
  }

  async function enableNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      showToast("Notificaties worden hier niet ondersteund");
      return;
    }

    const permission = await Notification.requestPermission();
    const state = getState();
    state.notifications.permission = permission;

    if (permission !== "granted") {
      setState(state);
      renderApp();
      showToast("Toestemming niet verleend");
      return;
    }

    await ensureServiceWorker();

    if (config.push && config.push.vapidPublicKey && config.push.subscriptionEndpoint) {
      await subscribeToPush();
    }

    state.notifications.lastSubscriptionAt = new Date().toISOString();
    setState(state);
    renderApp();
    showToast("Push notificaties staan aan");
  }

  async function ensureServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return null;
    }

    if (serviceWorkerRegistration) {
      return serviceWorkerRegistration;
    }

    serviceWorkerRegistration = await navigator.serviceWorker.register("./sw.js");
    return serviceWorkerRegistration;
  }

  async function subscribeToPush() {
    try {
      const registration = await ensureServiceWorker();
      if (!registration) {
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.push.vapidPublicKey),
      });

      await fetch(config.push.subscriptionEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: subscription,
          teamCode: getState().social.teamCode,
          profile: getState().profile,
        }),
      });
    } catch (error) {
      console.warn("Push subscription mislukt.", error);
      showToast("Push-endpoint nog niet klaar");
    }
  }

  async function showLocalNotification() {
    if (Notification.permission !== "granted") {
      await enableNotifications();
    }

    const registration = await ensureServiceWorker();
    if (!registration) {
      return;
    }

    await registration.showNotification("Pulse Habit", {
      body: "Tijd om je dagelijkse habits af te vinken.",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: "local-reminder",
    });
    showToast("Testnotificatie verstuurd");
  }

  function connectLocalState() {
    window.addEventListener("storage", function (event) {
      if (event.key === STORAGE_KEY) {
        renderApp();
      }
    });
  }

  function pageTitle(currentPage) {
    if (currentPage === "activity") {
      return "Maand resultaten";
    }

    return "My habits";
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function closeIcon() {
    return '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" d="M6 6 18 18M18 6 6 18" /></svg>';
  }

  function addIcon() {
    return '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" d="M12 5v14M5 12h14" /></svg>';
  }

  function homeIcon() {
    return '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 8 6.75v9.75a1.5 1.5 0 0 1-1.5 1.5H14v-6h-4v6H5.5A1.5 1.5 0 0 1 4 19.5V9.75L12 3Z" /></svg>';
  }

  function chartIcon() {
    return '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M5.5 19A1.5 1.5 0 0 1 4 17.5v-4A1.5 1.5 0 0 1 5.5 12h1A1.5 1.5 0 0 1 8 13.5v4A1.5 1.5 0 0 1 6.5 19h-1Zm6-7A1.5 1.5 0 0 1 10 10.5v-5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5v12a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 10 17.5v-5Zm6 7a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 17.5 8h1A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-1Z" /></svg>';
  }

  function monthCheckIcon() {
    return '<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12.5 9.5 17 19 7.5" /></svg>';
  }

  function checkIcon() {
    return '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12.5 9.5 17 19 7.5" /></svg>';
  }

  function chevronIcon(direction) {
    const path = direction === "left" ? "M14.5 6.5 8.5 12l6 5.5" : "M9.5 6.5 15.5 12l-6 5.5";
    return `<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="${path}" /></svg>`;
  }

  function getHabitIcon(name) {
    const value = String(name || "").toLowerCase();

    if (/(read|book|study|learn)/.test(value)) {
      return '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path stroke-linecap="round" stroke-linejoin="round" d="M5 6.5A2.5 2.5 0 0 1 7.5 4H19v14.5A1.5 1.5 0 0 0 17.5 17H7.75A2.75 2.75 0 0 0 5 19.75V6.5Zm0 0V20" /><path stroke-linecap="round" d="M9 8h6M9 11h6" /></svg>';
    }

    if (/(walk|run|cardio|steps|jog)/.test(value)) {
      return '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><circle cx="14.5" cy="5" r="2" /><path stroke-linecap="round" stroke-linejoin="round" d="m12.5 10.5 2.5-1.5 1.5 2.5 2.5 1M10 20l1.5-5 2 1.5V20M7 13l3-2.5 1-3" /></svg>';
    }

    if (/(water|drink|hydrat)/.test(value)) {
      return '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.7 3.4 5 6.3 5 9a5 5 0 1 1-10 0c0-2.7 2.3-5.6 5-9Z" /></svg>';
    }

    if (/(gym|workout|lift|stretch|yoga)/.test(value)) {
      return '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10v4M7 8v8M17 8v8M21 10v4M7 12h10" /></svg>';
    }

    if (/(sleep|bed|rest)/.test(value)) {
      return '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path stroke-linecap="round" stroke-linejoin="round" d="M4 18v-6h16v6M7 12V9a3 3 0 0 1 6 0v3" /><path stroke-linecap="round" d="M4 18h16" /></svg>';
    }

    if (/(meditat|breathe|calm|mind)/.test(value)) {
      return '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21c3.5-2.5 6-5.4 6-9a3 3 0 0 0-5.2-2A3.3 3.3 0 0 0 12 7a3.3 3.3 0 0 0-.8 3A3 3 0 0 0 6 12c0 3.6 2.5 6.5 6 9Z" /></svg>';
    }

    return '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21s-6-3.5-6-9a3.5 3.5 0 0 1 6-2.4A3.5 3.5 0 0 1 18 12c0 5.5-6 9-6 9Z" /></svg>';
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replaceAll("-", "+").replaceAll("_", "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let index = 0; index < rawData.length; index += 1) {
      outputArray[index] = rawData.charCodeAt(index);
    }

    return outputArray;
  }

  connectLocalState();
  renderApp();
})();
