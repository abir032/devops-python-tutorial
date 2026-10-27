import { useState } from "react";

import { STATUS_LABELS, PRIORITY_LABELS, type Task, type TaskInput, type TaskStatus } from "../types";
import { TaskForm } from "./TaskForm";

interface Props {
  task: Task;
  onUpdate: (id: number, data: Partial<TaskInput>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export function TaskItem({ task, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="task editing">
        <TaskForm
          initial={task}
          submitLabel="Save"
          onSubmit={async (data) => {
            await onUpdate(task.id, data);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className={`task status-${task.status}`}>
      <div className="task-main">
        <div className="task-title">
          <span className={`badge priority-${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
          <strong>{task.title}</strong>
        </div>
        {task.description && <p className="task-desc">{task.description}</p>}
        {task.due_date && <small className="muted">Due {task.due_date}</small>}
      </div>
      <div className="task-actions">
        <select
          aria-label="Status"
          value={task.status}
          onChange={(e) =>
            // Errors are shown by App's error banner.
            onUpdate(task.id, { status: e.target.value as TaskStatus }).catch(() => {})
          }
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          className="danger"
          onClick={() => {
            if (confirm(`Delete "${task.title}"?`)) onDelete(task.id).catch(() => {});
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
