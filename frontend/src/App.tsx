import { useCallback, useEffect, useState } from "react";

import * as api from "./api";
import { TaskForm } from "./components/TaskForm";
import { TaskItem } from "./components/TaskItem";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Task,
  type TaskFilters,
  type TaskInput,
  type TaskPriority,
  type TaskStatus,
} from "./types";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filters, setFilters] = useState<TaskFilters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await api.listTasks(filters));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  // Runs a mutation, then reloads so the list respects the active filters.
  async function mutate(action: () => Promise<unknown>) {
    try {
      await action();
      setError(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }

  const handleCreate = (data: TaskInput) => mutate(() => api.createTask(data));
  const handleUpdate = (id: number, data: Partial<TaskInput>) =>
    mutate(() => api.updateTask(id, data));
  const handleDelete = (id: number) => mutate(() => api.deleteTask(id));

  return (
    <main className="container">
      <h1>Task Planner</h1>

      <section className="card">
        <h2>New task</h2>
        <TaskForm submitLabel="Add task" onSubmit={handleCreate} />
      </section>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <section className="card">
        <div className="list-header">
          <h2>Tasks</h2>
          <div className="row">
            <select
              aria-label="Filter by status"
              value={filters.status ?? ""}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: (e.target.value || undefined) as TaskStatus }))
              }
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by priority"
              value={filters.priority ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  priority: (e.target.value || undefined) as TaskPriority,
                }))
              }
            >
              <option value="">All priorities</option>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading && tasks.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="muted">No tasks yet.</p>
        ) : (
          <ul className="task-list">
            {tasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
