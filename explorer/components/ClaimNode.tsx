'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

interface ClaimNodeData {
  label: string;
  predicate: string;
  governanceState: string;
  color: string;
  size: number;
  confidence: number;
  [key: string]: unknown;
}

function ClaimNode({ data }: NodeProps) {
  const d = data as unknown as ClaimNodeData;
  return (
    <div
      className="flex flex-col items-center justify-center rounded-full border-2 cursor-pointer transition-transform hover:scale-110"
      style={{
        width: d.size,
        height: d.size,
        borderColor: d.color,
        backgroundColor: `${d.color}20`,
      }}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <span
        className="text-[9px] text-center leading-tight text-white font-medium truncate px-1"
        style={{ maxWidth: d.size - 8 }}
      >
        {d.label}
      </span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

export default memo(ClaimNode);
