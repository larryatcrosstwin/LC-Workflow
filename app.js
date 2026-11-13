import { firebaseConfig } from "./firebase-config.js";

// Firebase library version, loaded straight from Google (no install needed).
const FIREBASE_URL = "https://www.gstatic.com/firebasejs/10.12.2";

// Where tasks are kept on this device when not syncing.
const STORAGE_KEY = "todo-tasks";

// Remembers which project filter you picked (on this device).
const FILTER_KEY = "task-project-filter";

// Special filter values (real project names are used as-is).
const ALL = "__all__";
const NO_PROJECT = "__none__";

// The three columns, in order.
const STATUSES = ["todo", "doing", "done"];

const $ = (id) => document.getElementById(id);
const form = $("task-form");
const input = $("task-input");
const dueInput = $("task-due");
const projectInput = $("task-project");
const projectFilter = $("project-filter");
const projectNames = $("project-names");
const clearCompletedButton = $("clear-completed");
const tasksSection = $("tasks-section");
const signInPanel = $("sign-in-panel");
const accountBar = $("account-bar");
const accountEmail = $("account-email");
const errorMessage = $("error-message");
const loadingMessage = $("loading-message");
const localNote = $("local-note");
const lists = Object.fromEntries(
  STATUSES.map((s) => [s, document.querySelector(`.card-list[data-status="${s}"]`)])
);

// Each task looks like:
// { id, text, project: "Work" or "", status: "todo" | "doing" | "done",
//   order: 0, dueDate: "2026-11-20" or "", createdAt }
// `order` is the position within its column (smaller = higher up = more important).
let tasks = [];

// `store` knows how to save changes. It is either the "this device only"
// store or the Firebase store. Both have the same functions:
// add, update, updateMany, remove, removeMany.
let store = null;

// While a card is being dragged, hold off redrawing so the drag isn't interrupted.
let dragging = false;
let renderWaiting = false;

// Which project is shown: ALL, NO_PROJECT or a project name.
let filter = loadFilter();

// Older tasks (from before the board) only had `done: true/false`.
// This fills in the newer fields so they show up in the right column.
function normalize(task) {
  return {
    id: task.id,
    text: task.text || "",
    project: (task.project || "").trim(),
    status: STATUSES.includes(task.status) ? task.status : task.done ? "done" : "todo",
    order: typeof task.order === "number" ? task.order : task.createdAt || 0,
    dueDate: task.dueDate || "",
    createdAt: task.createdAt || 0,
  };
}

// All tasks in a column, in order (ignores the project filter).
function tasksIn(status) {
  return tasks
    .filter((t) => t.status === status)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

// Does this task match the project filter?
function isVisible(task) {
  if (filter === ALL) return true;
  if (filter === NO_PROJECT) return !task.project;
  return task.project === filter;
}

function visibleIn(status) {
  return tasksIn(status).filter(isVisible);
}

// Project names in alphabetical order, ignoring upper/lower case.
function projectList() {
  const names = [...new Set(tasks.map((t) => t.project).filter(Boolean))];
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

// Gives each project its own color, always the same for the same name.
function projectHue(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  return hash;
}

// ---------- Project filter ----------

function loadFilter() {
  try {
    return localStorage.getItem(FILTER_KEY) || ALL;
  } catch {
    return ALL;
  }
}

function setFilter(value) {
  filter = value;
  try {
    localStorage.setItem(FILTER_KEY, value);
  } catch {
    // Not important if it can't be remembered.
  }
  // New tasks go into the project you are looking at.
  projectInput.value = filter === ALL || filter === NO_PROJECT ? "" : filter;
  render();
}

projectFilter.addEventListener("change", () => setFilter(projectFilter.value));

// Rebuilds the project drop-down and the typing suggestions.
function renderProjectChoices() {
  const projects = projectList();

  // If the chosen project no longer has any tasks, go back to "All projects".
  if (filter !== ALL && filter !== NO_PROJECT && !projects.includes(filter)) {
    filter = ALL;
  }

  const count = (match) => tasks.filter(match).length;
  const options = [
    [ALL, `All projects (${tasks.length})`],
    ...projects.map((name) => [name, `${name} (${count((t) => t.project === name)})`]),
  ];
  const withoutProject = count((t) => !t.project);
  if (projects.length && withoutProject) {
    options.push([NO_PROJECT, `No project (${withoutProject})`]);
  }
  if (filter === NO_PROJECT && !withoutProject) filter = ALL;

  projectFilter.innerHTML = "";
  for (const [value, label] of options) {
    projectFilter.append(new Option(label, value, false, value === filter));
  }

  projectNames.innerHTML = "";
  for (const name of projects) projectNames.append(new Option(name));
}

// Position for a task added to the bottom of a column.
function nextOrder(status) {
  const column = tasksIn(status);
  return column.length ? column[column.length - 1].order + 1 : 0;
}

// ---------- Due dates ----------

// Turns "2026-11-20" into a date at midnight local time.
function parseDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function describeDue(task) {
  if (!task.dueDate) return null;
  const due = parseDate(task.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due - today) / 86400000);
  const label = due.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(due.getFullYear() !== today.getFullYear() && { year: "numeric" }),
  });

  if (task.status === "done") return { text: `Due ${label}`, kind: "" };
  if (days < 0) return { text: `Overdue · ${label}`, kind: "overdue" };
  if (days === 0) return { text: "Due today", kind: "soon" };
  if (days === 1) return { text: "Due tomorrow", kind: "soon" };
  return { text: `Due ${label}`, kind: "" };
}

// ---------- Drawing the board ----------

function render() {
  if (dragging) {
    renderWaiting = true;
    return;
  }

  renderProjectChoices();

  for (const status of STATUSES) {
    const list = lists[status];
    const column = visibleIn(status);
    list.innerHTML = "";

    for (const task of column) {
      list.append(makeCard(task));
    }

    document.querySelector(`[data-count="${status}"]`).textContent = column.length || "";
  }

  clearCompletedButton.hidden = visibleIn("done").length === 0;
}

function makeCard(task) {
  const item = document.createElement("li");
  item.className = `card status-${task.status}`;
  item.dataset.id = task.id;

  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.textContent = "⠿";
  handle.title = "Drag to move";
  handle.setAttribute("aria-hidden", "true");

  // The whole card body is a button that opens the editor.
  const body = document.createElement("button");
  body.type = "button";
  body.className = "card-body";
  body.setAttribute("aria-label", `Edit "${task.text}"`);
  body.addEventListener("click", () => openEditor(task.id));

  const text = document.createElement("span");
  text.className = "card-text";
  text.textContent = task.text; // textContent keeps typed HTML from running
  body.append(text);

  const details = document.createElement("span");
  details.className = "card-details";

  if (task.project) {
    const tag = document.createElement("span");
    tag.className = "project-tag";
    tag.textContent = task.project;
    tag.style.setProperty("--hue", projectHue(task.project));
    details.append(tag);
  }

  const due = describeDue(task);
  if (due) {
    const badge = document.createElement("span");
    badge.className = `due-badge ${due.kind}`;
    badge.textContent = due.text;
    details.append(badge);
  }

  if (details.childElementCount) body.append(details);

  item.append(handle, body);
  return item;
}

// Switches between "loading", "signed out" and "showing tasks".
function showScreen(screen) {
  loadingMessage.hidden = screen !== "loading";
  signInPanel.hidden = screen !== "signed-out";
  tasksSection.hidden = screen !== "tasks";
}

function showError(error) {
  console.error(error);
  errorMessage.textContent = `Something went wrong: ${error?.message || error}`;
  errorMessage.hidden = false;
}

// Runs a save and shows an error if it fails.
async function run(promise) {
  try {
    errorMessage.hidden = true;
    await promise;
  } catch (error) {
    showError(error);
  }
}

// ---------- Drag and drop ----------

function setUpDragAndDrop() {
  if (!window.Sortable) {
    showError("Drag and drop could not load. Check your internet connection and refresh.");
    return;
  }
  for (const status of STATUSES) {
    window.Sortable.create(lists[status], {
      group: "tasks", // lets cards move between the three columns
      handle: ".drag-handle",
      animation: 150,
      ghostClass: "drag-ghost",
      chosenClass: "drag-chosen",
      onStart: () => {
        dragging = true;
      },
      onEnd: () => {
        dragging = false;
        saveOrderFromBoard();
      },
    });
  }
}

// After a drop, read the new order of cards straight from the page
// and save any task whose column or position changed.
//
// When a project filter is on, some tasks are hidden. Hidden tasks keep
// exactly the same spots; the visible tasks fill the other spots in their
// new order (any extra ones go at the bottom of the column).
function saveOrderFromBoard() {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const newColumns = {};

  for (const status of STATUSES) {
    const shown = [...lists[status].children]
      .map((card) => byId.get(card.dataset.id))
      .filter(Boolean);

    const column = tasksIn(status).map((task) => (isVisible(task) ? null : task));
    for (let i = 0; i < column.length && shown.length; i++) {
      if (column[i] === null) column[i] = shown.shift();
    }
    newColumns[status] = [...column.filter(Boolean), ...shown];
  }

  const changes = [];
  for (const status of STATUSES) {
    newColumns[status].forEach((task, position) => {
      if (task.status !== status || task.order !== position) {
        task.status = status;
        task.order = position;
        changes.push({ id: task.id, fields: { status, order: position } });
      }
    });
  }

  renderWaiting = false;
  render();
  if (changes.length && store) run(store.updateMany(changes));
}

// ---------- Adding ----------

form.addEventListener("submit", (event) => {
  event.preventDefault(); // stop the page from reloading
  const text = input.value.trim();
  if (text && store) {
    run(
      store.add({
        text,
        project: projectInput.value.trim(),
        status: "todo",
        order: nextOrder("todo"),
        dueDate: dueInput.value || "",
        createdAt: Date.now(),
      })
    );
    input.value = "";
    dueInput.value = "";
    // Keep the project filled in when you're looking at one project.
    if (filter === ALL || filter === NO_PROJECT) projectInput.value = "";
    input.focus();
  }
});

clearCompletedButton.addEventListener("click", () => {
  const done = visibleIn("done");
  const where = filter === ALL ? "" : filter === NO_PROJECT ? " with no project" : ` in "${filter}"`;
  if (done.length && confirm(`Delete ${done.length} completed ${done.length === 1 ? "task" : "tasks"}${where}?`)) {
    run(store.removeMany(done.map((t) => t.id)));
  }
});

// ---------- Editing ----------

const dialog = $("edit-dialog");
const editText = $("edit-text");
const editDue = $("edit-due");
const editProject = $("edit-project");
const editStatus = $("edit-status");
let editingId = null;

function openEditor(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  editingId = id;
  editText.value = task.text;
  editProject.value = task.project;
  editDue.value = task.dueDate;
  editStatus.value = task.status;
  dialog.showModal();
  editText.focus();
}

$("edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const task = tasks.find((t) => t.id === editingId);
  const text = editText.value.trim();
  if (!task || !text) return;

  const fields = { text, project: editProject.value.trim(), dueDate: editDue.value || "" };
  if (editStatus.value !== task.status) {
    // Moving to another column puts it at the bottom of that column.
    fields.status = editStatus.value;
    fields.order = nextOrder(editStatus.value);
  }
  run(store.update(task.id, fields));
  dialog.close();
});

$("edit-cancel").addEventListener("click", () => dialog.close());
$("edit-clear-due").addEventListener("click", () => (editDue.value = ""));

$("edit-delete").addEventListener("click", () => {
  const task = tasks.find((t) => t.id === editingId);
  if (task && confirm(`Delete "${task.text}"?`)) {
    run(store.remove(task.id));
    dialog.close();
  }
});

// Close the editor when tapping the dark area around it.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

// ---------- "This device only" storage ----------

function loadLocalTasks() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).map(normalize) : [];
  } catch {
    return [];
  }
}

function startLocalMode() {
  tasks = loadLocalTasks();

  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // Storage can be unavailable (e.g. some private browsing modes).
    }
    render();
  };
  const find = (id) => tasks.find((t) => t.id === id);

  store = {
    async add(fields) {
      tasks.push(normalize({ id: Date.now().toString(36), ...fields }));
      save();
    },
    async update(id, fields) {
      Object.assign(find(id) || {}, fields);
      save();
    },
    async updateMany(changes) {
      changes.forEach(({ id, fields }) => Object.assign(find(id) || {}, fields));
      save();
    },
    async remove(id) {
      tasks = tasks.filter((t) => t.id !== id);
      save();
    },
    async removeMany(ids) {
      tasks = tasks.filter((t) => !ids.includes(t.id));
      save();
    },
  };

  localNote.hidden = false;
  render();
  showScreen("tasks");
}

// ---------- Firebase (synced) storage ----------

async function startSyncedMode() {
  const [{ initializeApp }, authLib, db] = await Promise.all([
    import(`${FIREBASE_URL}/firebase-app.js`),
    import(`${FIREBASE_URL}/firebase-auth.js`),
    import(`${FIREBASE_URL}/firebase-firestore.js`),
  ]);

  const app = initializeApp(firebaseConfig);
  const auth = authLib.getAuth(app);
  const firestore = db.getFirestore(app);

  $("sign-in").addEventListener("click", () =>
    run(authLib.signInWithPopup(auth, new authLib.GoogleAuthProvider()))
  );
  $("sign-out").addEventListener("click", () => run(authLib.signOut(auth)));

  let stopListening = null;

  authLib.onAuthStateChanged(auth, async (user) => {
    if (stopListening) {
      stopListening();
      stopListening = null;
    }

    if (!user) {
      tasks = [];
      store = null;
      accountBar.hidden = true;
      showScreen("signed-out");
      return;
    }

    accountEmail.textContent = user.email || "Signed in";
    accountBar.hidden = false;
    showScreen("loading");

    // Each person's tasks live in their own folder: users/<their id>/tasks
    const tasksRef = db.collection(firestore, "users", user.uid, "tasks");
    const taskDoc = (id) => db.doc(tasksRef, id);

    await run(moveLocalTasksOnline(db, firestore, taskDoc));

    store = {
      add: (fields) => db.addDoc(tasksRef, fields),
      update: (id, fields) => db.updateDoc(taskDoc(id), fields),
      updateMany(changes) {
        const batch = db.writeBatch(firestore);
        changes.forEach(({ id, fields }) => batch.update(taskDoc(id), fields));
        return batch.commit();
      },
      remove: (id) => db.deleteDoc(taskDoc(id)),
      removeMany(ids) {
        const batch = db.writeBatch(firestore);
        ids.forEach((id) => batch.delete(taskDoc(id)));
        return batch.commit();
      },
    };

    // Live updates: whenever tasks change on any device, redraw them here.
    stopListening = db.onSnapshot(
      tasksRef,
      (snapshot) => {
        tasks = snapshot.docs.map((d) => normalize({ id: d.id, ...d.data() }));
        render();
        showScreen("tasks");
      },
      showError
    );
  });
}

// Tasks added before syncing was set up are copied online once,
// then removed from this device so they aren't copied again.
async function moveLocalTasksOnline(db, firestore, taskDoc) {
  const localTasks = loadLocalTasks();
  if (localTasks.length === 0) return;

  const batch = db.writeBatch(firestore);
  localTasks.forEach(({ id, ...fields }) => batch.set(taskDoc(id), fields));
  await batch.commit();
  localStorage.removeItem(STORAGE_KEY);
}

// ---------- Start ----------

setUpDragAndDrop();
// If a project was chosen last time, fill it into the "Project" box.
if (filter !== ALL && filter !== NO_PROJECT) projectInput.value = filter;

const syncIsSetUp = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE");

if (syncIsSetUp) {
  startSyncedMode().catch((error) => {
    showScreen("signed-out");
    showError(error);
  });
} else {
  startLocalMode();
}
