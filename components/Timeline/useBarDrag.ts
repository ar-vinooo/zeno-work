"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, type DragMode } from "@/lib/store";
import { childrenOf, subtreeIds, topMost } from "@/lib/tree";
import { daysForDx, snapToWeek, type Scale } from "@/lib/schedule";
import { diffDays, shiftISO } from "@/lib/dates";

const THRESHOLD = 4; // px — di bawah ini masih dianggap klik, bukan drag
const EDGE = 48; // px — zona auto-scroll di tepi timeline
const EDGE_SPEED = 14; // px per frame

interface DragState {
  ids: string[];
  mode: DragMode;
  anchorDate: string;
  startX: number;
  started: boolean;
}

/**
 * Drag bar timeline (§5.5): geser badan bar, atau tarik salah satu ujungnya.
 * Menulis pratinjau ke store supaya kolom Start/End ikut berubah real-time,
 * lalu meng-commit satu kali saat pointer dilepas — satu langkah undo.
 */
export function useBarDrag(scrollRef: React.RefObject<HTMLElement | null>) {
  const drag = useRef<DragState | null>(null);
  const [busy, setBusy] = useState(false);
  const autoScroll = useRef<number | null>(null);
  const pointerX = useRef(0);

  const stopAutoScroll = () => {
    if (autoScroll.current !== null) {
      cancelAnimationFrame(autoScroll.current);
      autoScroll.current = null;
    }
  };

  const finish = useCallback(
    (commit: boolean) => {
      const state = drag.current;
      drag.current = null;
      stopAutoScroll();
      setBusy(false);
      const preview = useStore.getState().preview;
      useStore.getState().setPreview(null);
      if (commit && state?.started && preview && preview.days !== 0)
        useStore.getState().dragSchedule(state.ids, state.mode, preview.days);
    },
    [],
  );

  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, finish]);

  const begin = useCallback(
    (event: React.PointerEvent, rowId: string, mode: DragMode, scale: Scale) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const { tasks, selection } = useStore.getState();
      const map = new Map(tasks.map((t) => [t.id, t]));
      const task = map.get(rowId);
      if (!task) return;

      const derived = task.rollup && childrenOf(tasks, rowId).length > 0;
      if (derived && mode !== "move") return; // durasi induk = hasil, bukan input

      // Drag pada baris yang termasuk pilihan menggeser seluruh pilihan.
      const ids = selection.includes(rowId) && selection.length > 1
        ? topMost(tasks, selection)
        : [rowId];

      const anchorDate = mode === "end" ? task.end : task.start;
      drag.current = {
        ids,
        mode,
        anchorDate,
        startX: event.clientX,
        started: false,
      };
      setBusy(true);
      (event.target as Element).setPointerCapture?.(event.pointerId);

      const affected = ids.flatMap((id) => {
        const t = map.get(id);
        const isParent = t?.rollup && childrenOf(tasks, id).length > 0;
        return isParent ? subtreeIds(tasks, id) : [id];
      });

      const move = (e: PointerEvent) => {
        const state = drag.current;
        if (!state) return;
        pointerX.current = e.clientX;
        const dx = e.clientX - state.startX;
        if (!state.started && Math.abs(dx) < THRESHOLD) return;
        state.started = true;

        let days = daysForDx(scale, dx);
        if (e.altKey) {
          const target = shiftISO(state.anchorDate, days);
          days = diffDays(state.anchorDate, snapToWeek(target));
        }
        useStore.getState().setPreview({ ids: affected, mode: state.mode, days });

        // Auto-scroll saat kursor mendekati tepi (§5.5.2).
        const pane = scrollRef.current;
        if (!pane) return;
        const box = pane.getBoundingClientRect();
        const near =
          e.clientX > box.right - EDGE
            ? EDGE_SPEED
            : e.clientX < box.left + EDGE
              ? -EDGE_SPEED
              : 0;
        if (near === 0) return stopAutoScroll();
        if (autoScroll.current !== null) return;
        const step = () => {
          const el = scrollRef.current;
          if (!el || !drag.current) return stopAutoScroll();
          const box2 = el.getBoundingClientRect();
          const speed =
            pointerX.current > box2.right - EDGE
              ? EDGE_SPEED
              : pointerX.current < box2.left + EDGE
                ? -EDGE_SPEED
                : 0;
          if (speed === 0) return stopAutoScroll();
          el.scrollLeft += speed;
          const state2 = drag.current;
          if (state2) {
            state2.startX -= speed;
            const dx2 = pointerX.current - state2.startX;
            let d2 = daysForDx(scale, dx2);
            useStore
              .getState()
              .setPreview({ ids: affected, mode: state2.mode, days: d2 });
          }
          autoScroll.current = requestAnimationFrame(step);
        };
        autoScroll.current = requestAnimationFrame(step);
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        finish(true);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [finish, scrollRef],
  );

  return { begin, busy };
}
