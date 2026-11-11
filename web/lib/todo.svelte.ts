// The Todo tab: each repository's README todo list, and edits to it.
import { api } from "./api.ts";
import { toast } from "./app.svelte.ts";
import { git } from "./git.svelte.ts";
import type { TodoItem, TodoList } from "./types.ts";

class Todos {
  /** per repository id; undefined while loading */
  lists = $state<Record<string, TodoList | undefined>>({});
  errors = $state<Record<string, string>>({});
  selected = $state(localStorage.getItem("ferry-todo-repo") || "");
  /** an edit is on its way, per item line */
  busy = $state<Record<string, boolean>>({});

  current = $derived(git.repos.find((r) => r.id === this.selected) ?? git.repos[0] ?? null);

  select(id: string): void {
    this.selected = id;
    localStorage.setItem("ferry-todo-repo", id);
  }

  async load(id: string): Promise<void> {
    try {
      this.lists[id] = await api<TodoList>("GET", `/git/${id}/todo`);
      delete this.errors[id];
    } catch (e) {
      this.errors[id] = (e as Error).message;
    }
  }

  async loadAll(): Promise<void> {
    if (!git.loaded) await git.refresh();
    await Promise.all(git.repos.map((r) => this.load(r.id)));
  }

  /** Ticks, unticks or dates an item; the README is changed and the list read again. */
  async edit(id: string, it: TodoItem, change: { done?: boolean; due?: string | null }): Promise<boolean> {
    const key = `${id}:${it.line}`;
    this.busy[key] = true;
    try {
      const r = await api<{ todo: TodoList }>("POST", `/git/${id}/todo-edit`, {
        line: it.line,
        raw: it.raw,
        ...change,
      });
      this.lists[id] = r.todo;
      return true;
    } catch (e) {
      toast((e as Error).message, { error: true });
      void this.load(id);
      return false;
    } finally {
      delete this.busy[key];
    }
  }
}

export const todos = new Todos();
