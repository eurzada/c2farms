# Settings & User Management

> **Status**: `Complete`
> **Priority**: `High`
> **Owner**:
> **Last Updated**: 2026-02-28

---

## Problem Statement

A farm isn't run by one person. The owner, the farm manager, the agronomist, the lender, and the accountant all need varying levels of access to the same farm data. Without role-based access, either everyone sees everything (security risk) or the owner becomes a bottleneck manually sharing reports. And when team members change — a new manager, a different advisor — access needs to be granted and revoked cleanly.

---

## Core Function

Admin-only module for managing who has access to the farm and what they can do. Handles user invitations (by email), role assignment (admin/manager/viewer), user removal, and farm data backup. Ensures every farm has at least one admin at all times.

---

## Who Uses This

| Role | Goal |
|------|------|
| Farm owner / admin | Invite team members, assign roles, remove access, create backups |
| Farm manager | N/A (no access to this module) |
| Viewer / advisor | N/A (no access to this module) |

---

## Enterprise Workflow

This module handles the **people side** of farm management:

**Onboarding a new team member:**
1. Admin navigates to Settings and enters the person's email + desired role
2. If the person already has a C2 Farms account → they get immediate access to the farm
3. If they don't have an account → a pending invite is created (valid 30 days)
4. When the person registers or logs in with that email, the invite auto-accepts and they see the farm

**Managing access:**
1. Admin can change any user's role (admin → manager, manager → viewer, etc.)
2. Admin can remove a user from the farm entirely
3. System prevents removing or demoting the last admin — every farm always has at least one

**Backup:**
1. Admin can export all farm data as a JSON file — assumptions, budget data, frozen data, categories, GL accounts, actuals

---

## Interconnections

### Feeds Into
- All modules — role determines what the user can see and do everywhere

### Receives From
- [[Yield & Assumptions]] — farm must exist before users can be managed

### Impacts
- All modules — changing a role from manager to viewer immediately restricts their edit access

---

## External Systems

| System | Role | Data Flow |
|--------|------|-----------|
| Email (future) | Notification of invites | Outbound (not yet implemented) |

---

## Key Business Rules

- Three roles: admin (full control), manager (read + write), viewer (read-only)
- Roles are per-farm — a user can be admin on one farm and viewer on another
- Last admin protection: cannot remove or demote the only admin
- Invites expire after 30 days
- Pending invites are auto-accepted on registration or login
- Farm deletion cascades to all related data (irreversible, admin-only)

---

## Open Questions

- Should we add email notifications when someone is invited?
- Should there be an activity log visible to admins (who changed what, when)?
- Is a "farm transfer" flow needed (transferring ownership to a new admin)?

---

## Notes & Sub-Topics

- RBAC middleware implementation
- Invite flow details
- Backup/restore procedures

---

## Related Notes

- [[Yield & Assumptions]]
- [[Cost Forecast]]
- [[Per-Unit Analysis]]
