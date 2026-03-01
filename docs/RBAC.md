# Role-Based Access Control (RBAC)

## Roles

C2 Farms uses three roles, assigned per-farm via the `UserFarmRole` table:

| Role | Description |
|------|-------------|
| **admin** | Full access. User management, settings, unfreeze budget, delete farm |
| **manager** | Read + write. Edit budgets, import data, freeze budget |
| **viewer** | Read-only. View all pages except Settings |

A user can have different roles on different farms (e.g., admin on Farm A, viewer on Farm B).

## Middleware Chain

Every farm-scoped request passes through this middleware stack (configured in `app.js`):

```
1. authenticate         →  Validates JWT, sets req.userId
2. requireFarmAccess    →  Checks UserFarmRole exists, sets req.farmRole
3. requireRole(...)     →  (on write endpoints) Checks req.farmRole ∈ allowed roles
```

### authenticate (`middleware/auth.js`)

Extracts the JWT from `Authorization: Bearer <token>`, verifies it, and sets `req.userId`. Returns `401` if missing or invalid.

### requireFarmAccess (`middleware/auth.js`)

Looks up `UserFarmRole` for `(req.userId, req.params.farmId)`. Sets `req.farmRole` to the role string. Returns `403` if no role exists.

Applied globally to all `/api/farms/:farmId/*` routes in `app.js`:
```js
app.use('/api/farms/:farmId', authenticate, requireFarmAccess);
```

### requireRole(...allowedRoles) (`middleware/auth.js`)

Checks `req.farmRole` against the allowed list. Returns `403` if not included. Must be used after `requireFarmAccess`.

```js
// Example: only admin and manager can edit
router.patch('/per-unit/:year/:month', requireRole('admin', 'manager'), handler);
```

## Permission Matrix

| Action | admin | manager | viewer |
|--------|:-----:|:-------:|:------:|
| View all pages | yes | yes | yes |
| Edit budget cells (per-unit/accounting) | yes | yes | no |
| Import CSV / GL actuals | yes | yes | no |
| Freeze budget | yes | yes | no |
| Unfreeze budget | yes | no | no |
| Export Excel/PDF | yes | yes | yes |
| Edit operational data | yes | yes | no |
| Manage categories / GL accounts | yes | yes | no |
| View Settings page | yes | no | no |
| Invite users | yes | no | no |
| Change user roles | yes | no | no |
| Remove users | yes | no | no |
| Delete farm | yes | no | no |
| Create backup | yes | no | no |

## Frontend Guards

The frontend mirrors backend permissions using context values from `FarmContext`:

```js
const { canEdit, isAdmin } = useFarm();
```

- **`canEdit`**: `true` for admin and manager roles. Controls visibility of edit buttons, save actions, import buttons, freeze button.
- **`isAdmin`**: `true` for admin role only. Controls visibility of Settings nav item, unfreeze button, delete farm option.

### Route-Level Guards

```jsx
// App.jsx
<Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
```

`AdminRoute` redirects non-admins to `/assumptions`.

### Component-Level Guards

```jsx
// In grid components
{canEdit && <Button onClick={handleSave}>Save</Button>}

// In Assumptions page
{isAdmin && <UnfreezeDialog />}
```

## Invite Flow

### Inviting an existing user
1. Admin enters email + role on Settings page
2. `POST /settings/users/invite` checks if email exists in `users` table
3. If yes: creates `UserFarmRole` directly → user sees the farm immediately

### Inviting a new user
1. Admin enters email + role
2. Email not found → creates `FarmInvite` (status: `pending`, expires in 30 days)
3. When the person registers or logs in with that email, pending invites are auto-accepted:
   - `FarmInvite.status` → `"accepted"`
   - `UserFarmRole` created with the invited role

### Invite management
- Admins can view pending invites on the Settings page
- Admins can cancel (delete) pending invites
- Expired invites are not automatically cleaned up but won't be auto-accepted

## Last Admin Protection

The system prevents removing or demoting the last admin of a farm:

- `PATCH /settings/users/:userId` — refuses to change role if this is the only admin
- `DELETE /settings/users/:userId` — refuses to remove if this is the only admin

This ensures every farm always has at least one admin.
