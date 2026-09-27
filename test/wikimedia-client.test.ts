import assert from "node:assert/strict";
import { lastDayOfMonth, resolveEndDate } from "../scripts/wikimedia-client";

let passed = 0;
function check(name: string, fn: () => void) {
	fn();
	passed++;
	console.log(`ok: ${name}`);
}

check("lastDayOfMonth handles a 30-day month", () => {
	assert.equal(lastDayOfMonth("2025-09-01"), "2025-09-30");
});
check("lastDayOfMonth handles a 31-day month", () => {
	assert.equal(lastDayOfMonth("2025-01-15"), "2025-01-31");
});
check("lastDayOfMonth handles February in a leap year", () => {
	assert.equal(lastDayOfMonth("2024-02-03"), "2024-02-29");
});
check("lastDayOfMonth handles February in a non-leap year", () => {
	assert.equal(lastDayOfMonth("2025-02-01"), "2025-02-28");
});
check("resolveEndDate rolls monthly end dates forward to end-of-month", () => {
	assert.equal(resolveEndDate("2025-09-01", "monthly"), "2025-09-30");
});
check("resolveEndDate leaves daily end dates untouched", () => {
	assert.equal(resolveEndDate("2025-09-01", "daily"), "2025-09-01");
});

console.log(`\n${passed} wikimedia-client checks passed.`);
