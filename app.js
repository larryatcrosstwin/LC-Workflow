// Tasks are saved in the browser's local storage under this name,
// so they are still there when you reload or reopen the page.
const STORAGE_KEY = "todo-tasks";

const form = document.getElementById("task-form");
const input = document.getElementById("task-input");
const list = document.getElementById("task-list");
const emptyMessage = document.getElementById("empty-message");
const taskCount = document.getElementById("task-count");
const clearCompletedButton = document.getElementById("clear-completed");

// Each task looks like: { id: "abc", text: "Buy milk", done: false }
let tasks = loadTasks();

function loadTasks() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // Storage can be unavailable (e.g. some private browsing modes).
  }
}

function addTask(text) {
  tasks.push({ id: Date.now().toString(36), text, done: false });
  saveTasks();
  render();
}

function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task.done = !task.done;
    saveTasks();
    render();
  }
}

function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  saveTasks();
  render();
}

function clearCompleted() {
  tasks = tasks.filter((t) => !t.done);
  saveTasks();
  render();
}

// Redraws the whole list from the `tasks` array.
function render() {
  list.innerHTML = "";

  for (const task of tasks) {
    const item = document.createElement("li");
    item.className = task.done ? "task done" : "task";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `Mark "${task.text}" as done`);
    checkbox.addEventListener("change", () => toggleTask(task.id));

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text; // textContent keeps typed HTML from running

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "×";
    deleteButton.setAttribute("aria-label", `Delete "${task.text}"`);
    deleteButton.addEventListener("click", () => deleteTask(task.id));

    item.append(checkbox, text, deleteButton);
    list.append(item);
  }

  const remaining = tasks.filter((t) => !t.done).length;
  const hasDone = tasks.some((t) => t.done);

  emptyMessage.hidden = tasks.length > 0;
  taskCount.textContent =
    tasks.length === 0 ? "" : `${remaining} ${remaining === 1 ? "task" : "tasks"} left`;
  clearCompletedButton.hidden = !hasDone;
}

form.addEventListener("submit", (event) => {
  event.preventDefault(); // stop the page from reloading
  const text = input.value.trim();
  if (text) {
    addTask(text);
    input.value = "";
    input.focus();
  }
});

clearCompletedButton.addEventListener("click", clearCompleted);

render();
