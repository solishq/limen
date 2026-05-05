# Refusal Analytics Dashboard

## Overview

The Refusal Analytics page (`/refusals`) provides visibility into governance
refusals across the Limen knowledge graph. It surfaces patterns in why beliefs
are refused, which tenants generate the most refusals, and how refusal rates
trend over time.

## Features

### Stat Cards
- **Total Refusals** — absolute count of governance refusals in the selected period.
- **Refusal Rate** — ratio of refused operations to total operations (0-100%).
- **Governance Impact Score** — composite score (0-1) measuring how much refusals
  affect system throughput.

### Top Refusal Reasons (Bar Chart)
Displays the most common refusal reasons ranked by frequency. Useful for
identifying systemic policy misconfigurations or over-restrictive governance.

### Refusal Trend (Line Chart)
30-day daily refusal count. Spikes indicate governance changes or agent
misbehavior. Flat lines near zero indicate healthy operation.

### By Governance State / By Tenant (Tables)
Breakdown tables showing refusal distribution across lifecycle states and
tenant scopes. Use these to identify if specific tenants or states are
disproportionately affected.

## Filters

| Filter     | Description                              |
|------------|------------------------------------------|
| Tenant     | Scope results to a specific tenant       |
| Start Date | Beginning of analysis window (ISO date)  |
| End Date   | End of analysis window (ISO date)        |

Click **Apply** after changing filters to reload data.

## API Endpoints

- `GET /refusals/analytics` — full analytics payload
- `GET /refusals/trends` — daily trend data (optional `days` query param)

## Interpreting Results

- A high governance impact score (>0.5) suggests refusals are blocking
  meaningful work and governance rules should be reviewed.
- If one tenant dominates refusals, investigate its agent configuration.
- Rising trends without policy changes may indicate drift in agent behavior.

## Troubleshooting

- **No data shown**: Verify the backend is running and has refusal events.
- **Connection Error**: Check `NEXT_PUBLIC_API_URL` environment variable.
- **Empty charts**: The time range may exclude all refusal events.
