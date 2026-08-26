import { test } from "node:test";
import assert from "node:assert/strict";
import { can, permissionsFor } from "../../src/types/permissions.ts";
import { USER_ROLES } from "../../src/types/domain.ts";

/**
 * The permission map decides what the interface offers. It is not the
 * security boundary - the database refuses the same things independently,
 * and tests/db/test_workflow.js proves that. These assertions are here
 * because the two must not drift: a screen that offers an action the
 * database will refuse is a bug even though nothing unsafe happens.
 */

test("a driver is not offered the ability to sell", () => {
  assert.equal(can("driver", "sales.create"), false);
  // They still see what left the van, which is the point of their screen.
  assert.equal(can("driver", "sales.view"), true);
});

test("a driver cannot adjust stock or manage the catalogue", () => {
  for (const capability of [
    "inventory.adjust", "inventory.count", "inventory.transfer",
    "products.create", "products.edit", "vans.manage",
  ] as const) {
    assert.equal(can("driver", capability), false, `driver should not hold ${capability}`);
  }
});

test("a salesperson can sell but cannot change stock", () => {
  assert.equal(can("sales_rep", "sales.create"), true);
  assert.equal(can("sales_rep", "inventory.adjust"), false);
  assert.equal(can("sales_rep", "inventory.count"), false);
  assert.equal(can("sales_rep", "products.create"), false);
  assert.equal(can("sales_rep", "vans.manage"), false);
});

test("both seats of a van crew reach their own van screen", () => {
  assert.equal(can("driver", "vans.crew"), true);
  assert.equal(can("sales_rep", "vans.crew"), true);
  // A manager has no van of their own; My van would be empty for them.
  assert.equal(can("manager", "vans.crew"), false);
  assert.equal(can("accountant", "vans.crew"), false);
});

test("managers and administrators keep stock control", () => {
  for (const role of ["admin", "senior_manager", "manager"] as const) {
    assert.equal(can(role, "inventory.adjust"), true, `${role} should adjust stock`);
    assert.equal(can(role, "inventory.count"), true, `${role} should run a count`);
    assert.equal(can(role, "products.create"), true, `${role} should create products`);
    assert.equal(can(role, "vans.manage"), true, `${role} should assign crew`);
  }
});

test("the warehouse role counts and receives but does not sell", () => {
  assert.equal(can("warehouse", "inventory.count"), true);
  assert.equal(can("warehouse", "inventory.adjust"), true);
  assert.equal(can("warehouse", "sales.create"), false);
});

test("an accountant reads and never writes stock", () => {
  assert.equal(can("accountant", "inventory.view"), true);
  assert.equal(can("accountant", "inventory.adjust"), false);
  assert.equal(can("accountant", "sales.create"), false);
});

test("every role has a home screen", () => {
  for (const role of USER_ROLES) {
    assert.ok(permissionsFor(role).length > 0, `${role} has no permissions`);
    assert.equal(can(role, "dashboard.view"), true, `${role} cannot see the dashboard`);
  }
});

// Navigation itself is not asserted here: src/lib/navigation.ts imports
// through the "@/" alias, which this runner has no resolver for. What
// decides whether a role is shown Sell or My van is the permission on the
// nav item - sales.create and vans.crew - and those are covered above.
