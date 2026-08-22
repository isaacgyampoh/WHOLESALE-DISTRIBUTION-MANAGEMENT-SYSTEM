import { test } from "node:test";
import assert from "node:assert/strict";
import { can, permissionsFor, PERMISSIONS } from "../../src/types/permissions.ts";
import type { UserRole } from "../../src/types/domain.ts";

/**
 * The separations of duty, asserted rather than assumed.
 *
 * This map decides what the interface offers, not what the database
 * allows - the real boundary is row level security and the checks inside
 * the SECURITY DEFINER functions, and every rule below is enforced there
 * too. What these tests protect is the second half of the same idea:
 * offering somebody a button that the database will refuse is a bug
 * whichever way round it fails.
 *
 * They are written as invariants rather than as a copy of the map, so
 * adding a permission to a role does not quietly break one of them.
 */

const ROLES: UserRole[] = [
  "admin", "senior_manager", "manager", "warehouse", "accountant", "sales_rep", "driver",
];

test("a warehouse cannot approve its own transfers", () => {
  // The control that makes a transfer a transfer. A depot that can both
  // raise and approve moves stock wherever it likes.
  assert.ok(can("warehouse", "inventory.transfer"));
  assert.equal(can("warehouse", "transfers.approve"), false);
});

test("approving a transfer is a management job", () => {
  const approvers = ROLES.filter((r) => can(r, "transfers.approve"));
  assert.deepEqual(approvers, ["admin", "senior_manager", "manager"]);
});

test("a driver reads the waybill they carry but does not write it", () => {
  assert.ok(can("driver", "documents.view"));
  assert.equal(can("driver", "documents.issue"), false);
});

test("an accountant keeps the books and does not sign goods out", () => {
  assert.ok(can("accountant", "documents.view"));
  assert.equal(can("accountant", "documents.issue"), false);
  assert.equal(can("accountant", "inventory.transfer"), false);
});

test("nobody but an administrator manages roles", () => {
  const holders = ROLES.filter((r) => can(r, "roles.manage"));
  assert.deepEqual(holders, ["admin"]);
});

test("a driver never reaches the office screens", () => {
  for (const permission of ["users.manage", "products.edit", "reports.view"] as const) {
    assert.equal(can("driver", permission), false, permission);
  }
});

test("anyone who can act on something can also see it", () => {
  // Offering an action on a screen the role cannot open is a dead end.
  const pairs = [
    ["documents.issue", "documents.view"],
    ["transfers.approve", "inventory.view"],
    ["payments.create", "payments.view"],
    ["sales.create", "sales.view"],
    ["returns.approve", "returns.view"],
    ["reconciliation.approve", "reconciliation.view"],
  ] as const;

  for (const role of ROLES) {
    for (const [action, view] of pairs) {
      if (can(role, action)) {
        assert.ok(can(role, view), `${role} has ${action} without ${view}`);
      }
    }
  }
});

test("every declared permission belongs to somebody", () => {
  // A permission no role holds is either a gate nobody can pass or a
  // leftover from something removed.
  const orphans = PERMISSIONS.filter((p) => !ROLES.some((r) => can(r, p)));
  assert.deepEqual(orphans, []);
});

test("every role has a home to land on after signing in", () => {
  for (const role of ROLES) {
    assert.ok(can(role, "dashboard.view"), role);
    assert.ok(permissionsFor(role).length > 0, role);
  }
});
