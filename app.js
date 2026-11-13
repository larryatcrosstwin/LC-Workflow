import { firebaseConfig } from "./firebase-config.js";

// Firebase library version, loaded straight from Google (no install needed).
const FIREBASE_URL = "https://www.gstatic.com/firebasejs/10.12.2";

// Where tasks are kept on this device when not syncing.
const STORAGE_KEY = "todo-tasks";

const $ = (id) => document.getElementById(id);
const form = $("task-form");
const input = $("task-input");
const list = $("task-list");
const emptyMessage = $("empty-message");
const taskCount = $("task-count");
const clearCompletedButton = $("clear-completed");
const tasksSection = $("tasks-section");
const signInPanel = $("sign-in-panel");
const accountBar = $("account-bar");
const accountEmail = $("account-email");
const errorMessage = $("error-message");
const loadingMessage = $("loading-message");
const localNote = $("local-note");

// Each task looks like: { id: "abc", text: "Buy milk", done: false }
let tasks = [];

// `store` knows how to save changes. It is either the "this device only"
// store or the Firebase store, depending on whether Firebase is set up.
// Both have the same four functions: add, toggle, remove, clearCompleted.
let store = null;

// ---------- Drawing the page ----------

function render() {
  list.innerHTML = "";

  for (const task of tasks) {
    const item = document.createElement("li");
    item.className = task.done ? "task done" : "task";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `Mark "${task.text}" as done`);
    checkbox.addEventListener("change", () => run(store.toggle(task)));

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text; // textContent keeps typed HTML from running

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "×";
    deleteButton.setAttribute("aria-label", `Delete "${task.text}"`);
    deleteButton.addEventListener("click", () => run(store.remove(task.id)));

    item.append(checkbox, text, deleteButton);
    list.append(item);
  }

  const remaining = tasks.filter((t) => !t.done).length;

  emptyMessage.hidden = tasks.length > 0;
  taskCount.textContent =
    tasks.length === 0 ? "" : `${remaining} ${remaining === 1 ? "task" : "tasks"} left`;
  clearCompletedButton.hidden = !tasks.some((t) => t.done);
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

form.addEventListener("submit", (event) => {
  event.preventDefault(); // stop the page from reloading
  const text = input.value.trim();
  if (text && store) {
    run(store.add(text));
    input.value = "";
    input.focus();
  }
});

clearCompletedButton.addEventListener("click", () => run(store.clearCompleted()));

// ---------- "This device only" storage ----------

function loadLocalTasks() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
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

  store = {
    async add(text) {
      tasks.push({ id: Date.now().toString(36), text, done: false });
      save();
    },
    async toggle(task) {
      task.done = !task.done;
      save();
    },
    async remove(id) {
      tasks = tasks.filter((t) => t.id !== id);
      save();
    },
    async clearCompleted() {
      tasks = tasks.filter((t) => !t.done);
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
      add: (text) => db.addDoc(tasksRef, { text, done: false, createdAt: Date.now() }),
      toggle: (task) => db.updateDoc(taskDoc(task.id), { done: !task.done }),
      remove: (id) => db.deleteDoc(taskDoc(id)),
      clearCompleted() {
        const batch = db.writeBatch(firestore);
        tasks.filter((t) => t.done).forEach((t) => batch.delete(taskDoc(t.id)));
        return batch.commit();
      },
    };

    // Live updates: whenever the list changes on any device, redraw it here.
    stopListening = db.onSnapshot(
      db.query(tasksRef, db.orderBy("createdAt")),
      (snapshot) => {
        tasks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
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
  const now = Date.now();
  localTasks.forEach((t, i) =>
    batch.set(taskDoc(t.id), { text: t.text, done: !!t.done, createdAt: now + i })
  );
  await batch.commit();
  localStorage.removeItem(STORAGE_KEY);
}

// ---------- Start ----------

const syncIsSetUp = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE");

if (syncIsSetUp) {
  startSyncedMode().catch((error) => {
    showScreen("signed-out");
    showError(error);
  });
} else {
  startLocalMode();
}
