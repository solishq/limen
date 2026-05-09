// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
'use client';

import dynamic from 'next/dynamic';

const GraphCanvas = dynamic(() => import('@/components/GraphCanvas'), { ssr: false });

export default function Home() {
  return <GraphCanvas />;
}
