"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { imageUrl } from "@/lib/cloudinary";
import { useArtworkOrder } from "./AdminProvider";

/**
 * Admin-only, desktop-only right-side panel for drag-to-reorder. Rendered by the
 * collection page (it has the artworks); returns null for visitors so the
 * logged-out layout is unchanged. Drops stage the new order in the shared store,
 * which the ReorderableArtworkList live-previews in the main stack.
 */

interface PanelArtwork {
  slug: string;
  name: string;
  image: string;
}

/** Shared row visuals — reused by the sortable row and the drag overlay clone. */
function RowContent({
  artwork,
  position,
  dragging = false,
  handleProps,
}: {
  artwork: PanelArtwork;
  position: number;
  dragging?: boolean;
  handleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-[2px] border bg-page px-2 py-1.5 ${
        dragging
          ? "scale-[1.03] border-steel shadow-lg"
          : "border-hairline"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl(artwork.image, 200)}
        alt=""
        className="h-10 w-14 shrink-0 rounded-[1px] bg-placeholder object-cover"
      />
      <span className="min-w-0 grow truncate text-[13px] text-ink">
        {artwork.name}
      </span>
      <span className="shrink-0 font-pixel text-[10px] text-ink-faint tabular-nums">
        {position}
      </span>
      <button
        type="button"
        aria-label={`Drag ${artwork.name}`}
        className="-mr-1 shrink-0 cursor-grab touch-none px-1 text-ink-faint hover:text-steel active:cursor-grabbing"
        {...handleProps}
      >
        {/* six-dot drag handle */}
        <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
          <g fill="currentColor">
            <circle cx="3" cy="3" r="1.4" />
            <circle cx="9" cy="3" r="1.4" />
            <circle cx="3" cy="8" r="1.4" />
            <circle cx="9" cy="8" r="1.4" />
            <circle cx="3" cy="13" r="1.4" />
            <circle cx="9" cy="13" r="1.4" />
          </g>
        </svg>
      </button>
    </div>
  );
}

function SortableRow({
  artwork,
  position,
}: {
  artwork: PanelArtwork;
  position: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: artwork.image });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    // Always-on generous slide so rows visibly percolate past the dragged one.
    transition: transition ?? "transform 200ms ease",
    // The lifted row is shown by the DragOverlay clone; hide the source.
    opacity: isDragging ? 0 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="list-none">
      <RowContent
        artwork={artwork}
        position={position}
        handleProps={{ ...attributes, ...listeners }}
      />
    </li>
  );
}

export default function ReorderPanel({
  collectionPath,
  artworks,
}: {
  collectionPath: string;
  artworks: PanelArtwork[];
}) {
  const { isAdmin, getStagedOrder, stageOrder } = useArtworkOrder();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    // 4px activation distance so a plain click on the handle doesn't start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (!isAdmin) return null;

  const savedIds = artworks.map((a) => a.image);
  const byId = new Map(artworks.map((a) => [a.image, a]));
  const staged = getStagedOrder(collectionPath);
  const orderIds = staged ?? savedIds;
  const activeArtwork = activeId ? byId.get(activeId) : null;
  const activePosition = activeId ? orderIds.indexOf(activeId) + 1 : 0;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = orderIds.indexOf(String(active.id));
    const to = orderIds.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = arrayMove(orderIds, from, to);
    // Dragging back to the saved order removes the staged entry entirely.
    const isOriginal = next.every((id, i) => id === savedIds[i]);
    stageOrder(collectionPath, isOriginal ? null : next);
  }

  return (
    <aside className="sticky top-0 hidden max-h-[calc(100vh-6rem)] w-[220px] shrink-0 self-start overflow-y-auto px-3 pt-[34px] desk:block">
      <h2 className="mb-2 font-pixel text-[11px] text-ink-muted">reorder</h2>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext
          items={orderIds}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-1.5">
            {orderIds.map((id, i) => {
              const artwork = byId.get(id);
              if (!artwork) return null;
              return (
                <SortableRow key={id} artwork={artwork} position={i + 1} />
              );
            })}
          </ul>
        </SortableContext>
        {/* Floating clone that settles into its slot on release (no snap). */}
        <DragOverlay>
          {activeArtwork ? (
            <RowContent
              artwork={activeArtwork}
              position={activePosition}
              dragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </aside>
  );
}
