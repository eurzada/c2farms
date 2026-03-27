# Shipment Dispatch Module — Design Document

## Overview

The Shipment Dispatch module adds proactive grain movement planning to Logistics. It introduces a **ShipmentOrder** — a dispatch work order that sits between a Marketing Contract and a Delivery Ticket — closing the data gap where Collin currently uses WhatsApp and spreadsheets.

## Data Flow

```
MarketingContract (existing)
    ↓ marketing_contract_id
ShipmentOrder (NEW) ← InventoryLocation/Bin (existing)
    ↓ shipment_order_id
ShipmentAssignment (NEW) ← User/Trucker (existing, extended)
    ↓ shipment_assignment_id
DeliveryTicket (existing, gains FK)
    ↓
Settlement (existing, unchanged)
```

## Data Model

### New: ShipmentOrder
- `id`, `farm_id`, `marketing_contract_id` (FK)
- `source_location_id` (FK → InventoryLocation), `source_bin_id` (FK → InventoryBin, nullable)
- `target_loads` (int), `completed_loads` (int, default 0)
- `estimated_mt_per_load` (float) — trucker capacity estimate
- `delivery_window_start`, `delivery_window_end` (Date)
- `status`: draft → dispatched → in_progress → complete → cancelled
- `notes` (text), `created_by` (FK → User)
- `created_at`, `updated_at`

### New: ShipmentAssignment
- `id`, `shipment_order_id` (FK), `trucker_user_id` (FK → User)
- `status`: pending → acknowledged → loading → en_route → delivered
- `acknowledged_at`, `loaded_at`, `delivered_at` (nullable timestamps)
- `created_at`, `updated_at`

### Extended: DeliveryTicket
- Add `shipment_assignment_id` (FK → ShipmentAssignment, nullable)
- When set, auto-resolve contract/buyer/commodity from assignment → order → contract

### Extended: User (truckers)
- Add `truck_capacity_mt` (float, nullable) — default load size for dispatch estimates
- Add `trucker_status` (string, nullable): available / on_load / off

## API Endpoints

### Shipment Orders
- `GET /:farmId/dispatch/orders` — list with filters (status, contract_id, date range)
- `GET /:farmId/dispatch/orders/:id` — detail with assignments + linked tickets
- `POST /:farmId/dispatch/orders` — create (optionally dispatch immediately)
- `PATCH /:farmId/dispatch/orders/:id` — update draft
- `POST /:farmId/dispatch/orders/:id/dispatch` — transition to dispatched, create assignments
- `POST /:farmId/dispatch/orders/:id/cancel` — cancel with reason
- `POST /:farmId/dispatch/orders/:id/complete` — mark complete

### Assignments (trucker-facing)
- `GET /:farmId/dispatch/my-assignments` — trucker's active assignments
- `POST /:farmId/dispatch/assignments/:id/acknowledge`
- `POST /:farmId/dispatch/assignments/:id/loaded`
- `POST /:farmId/dispatch/assignments/:id/deliver` — creates DeliveryTicket, auto-links contract

### Dashboard
- `GET /:farmId/dispatch/dashboard` — contract fill status, active orders, trucker availability, activity feed

## UI: Dispatch Board (Logistics → Dispatch)

Collin's control centre. Desktop-first, three sections:

1. **Contract Queue** — contracts with remaining_mt > 0, sorted by delivery window urgency
2. **Active Orders** — ShipmentOrders in dispatched/in_progress, with live progress bars
3. **Trucker Roster** — available truckers with capacity, current assignment status

Create flow: Select contract → pick source bin → set loads + MT/load → assign truckers → dispatch.

## UI: Mobile "My Loads" Tab

New tab in existing React Native app:
- List of active ShipmentAssignments for the logged-in trucker
- Each card: pickup location, destination elevator, crop/grade, buyer (all from order → contract)
- Status buttons: Acknowledge → Loading → En Route → Deliver (opens ticket entry)

## Integration

- **recalculateContract()** fires when dispatched tickets are submitted
- **Settlement reconciliation** unchanged — tickets arrive pre-linked
- **Socket.io** broadcasts status changes to Dispatch Board in real-time
- **Traction Ag coexistence** — non-dispatched tickets still arrive via CSV, follow manual-link path

## Build Phases

- **Phase 1**: ShipmentOrder + Assignment models, Dispatch Board page, auto-linking on ticket submit
- **Phase 2**: Mobile "My Loads" tab, status flow, push notifications
- **Phase 3**: Fill velocity analytics, trucker utilization, suggested bin allocation
