import React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

export function PipelineDeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const onDelete = data?.onDelete as ((edgeId: string) => void) | undefined;

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan z-20 flex items-center gap-1.5 rounded-full border border-[#d8d0c0] bg-[#fffdf8] px-2.5 py-0.5 text-[10px] font-mono text-neutral-800 shadow-xs"
        >
          {label ? <span className="font-semibold text-stone-800">{label}</span> : null}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(id);
              }}
              title="Putuskan kabel ini"
              aria-label="Putuskan kabel ini"
              className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full bg-stone-200 text-[10px] font-bold text-stone-600 transition-colors hover:bg-[#9a3412] hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
