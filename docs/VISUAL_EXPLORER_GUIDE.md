# Visual Explorer Guide

## Overview

The Limen Visual Explorer is a graph visualization tool for exploring governed beliefs, their provenance chains, and governance state transitions. It renders the Limen knowledge graph as an interactive node-edge diagram where nodes represent beliefs, governance decisions, authority grants, and refusals. Edges encode provenance, governance relationships, cascades, and refusal chains.

The system consists of two components: a Rust API server (port 3001) exposing graph data, and a Next.js frontend (port 3000) rendering the interactive visualization.

## Quick Start

```bash
# Terminal 1: API server
cd v5 && cargo run -p limen_graph
# Listening on http://0.0.0.0:3001

# Terminal 2: Explorer UI
cd explorer && npm install && npm run dev
# Ready on http://localhost:3000
```

## API Reference

### GET /graph/nodes

Retrieve nodes with optional filtering.

```bash
curl "http://localhost:3001/graph/nodes?governance_state=active&node_type=belief&limit=10"
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| tenant_scope | string | Filter by tenant identifier |
| governance_state | string | One of: active, suspended, revoked, pending, archived |
| node_type | string | One of: belief, governance, authority, refusal |
| min_confidence | float | Minimum confidence threshold (0.0-1.0) |
| limit | integer | Max results (default: 50) |
| offset | integer | Pagination offset |

**Response:**

```json
[
  {
    "id": "node_001",
    "node_type": "belief",
    "label": "entity:project:limen decision.architecture",
    "tenant_scope": "default",
    "governance_state": "active",
    "confidence": 0.85,
    "created_at": "2026-05-01T10:00:00Z",
    "metadata": {}
  }
]
```

### GET /graph/edges

Retrieve all edges connected to a specific node.

```bash
curl "http://localhost:3001/graph/edges?node_id=node_001"
```

**Response:**

```json
[
  {
    "id": "edge_001",
    "edge_type": "provenance",
    "source_id": "node_001",
    "target_id": "node_002",
    "weight": 1.0,
    "label": "derived_from",
    "created_at": "2026-05-01T10:01:00Z"
  }
]
```

### GET /graph/stats

Aggregate statistics for the entire graph.

```bash
curl "http://localhost:3001/graph/stats"
```

**Response:**

```json
{
  "total_nodes": 42,
  "total_edges": 67,
  "nodes_by_type": { "belief": 30, "governance": 8, "authority": 3, "refusal": 1 },
  "nodes_by_state": { "active": 35, "suspended": 4, "revoked": 2, "pending": 1, "archived": 0 },
  "avg_confidence": 0.78
}
```

### POST /graph/query

Advanced multi-filter query with time range support.

```bash
curl -X POST http://localhost:3001/graph/query \
  -H "Content-Type: application/json" \
  -d '{
    "filters": [
      { "governance_state": "active", "min_confidence": 0.7 },
      { "node_type": "refusal" }
    ],
    "limit": 25
  }'
```

**Response:** Array of `GraphNode` objects matching any of the provided filters.

## Features

**Node coloring by governance state:** Active (green), Suspended (amber), Revoked (red), Pending (blue), Archived (grey).

**Node shape by type:** Beliefs as circles, governance decisions as diamonds, authority grants as hexagons, refusals as squares.

**Click for details:** Opens a detail panel with full metadata, confidence score, creation timestamp, and connected edges.

**Filtering:** Sidebar filters for governance state, node type, confidence threshold, and tenant scope. Applied in real-time.

**Stats panel:** Top bar shows live aggregate statistics (total nodes/edges, average confidence, state distribution).

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| NEXT_PUBLIC_API_URL | http://localhost:3001 | Graph API base URL |

Set in `explorer/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

For production deployments, point this to the deployed API host.
