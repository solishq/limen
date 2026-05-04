'use client';

import dynamic from 'next/dynamic';

const GraphCanvas = dynamic(() => import('@/components/GraphCanvas'), { ssr: false });

export default function Home() {
  return <GraphCanvas />;
}
