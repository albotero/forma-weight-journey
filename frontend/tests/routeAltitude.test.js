import assert from "node:assert/strict"
import test from "node:test"
import { routeAltitudeColor, routeAltitudeRange } from "../src/lib/routeAltitude.js"

test("route altitude scale uses reliable samples and ignores missing or estimated elevations", () => {
  assert.deepEqual(
    routeAltitudeRange([
      { altitude_m: 120, estimated: false },
      { altitude_m: 240, estimated: false },
      { altitude_m: 900, estimated: true },
      { altitude_m: null },
    ]),
    { min: 120, max: 240 },
  )
  assert.equal(routeAltitudeRange([{ altitude_m: null }]), null)
})

test("route altitude colors vary continuously from lower to higher elevations", () => {
  const range = { min: 100, max: 200 }
  const low = routeAltitudeColor(100, range)
  const middle = routeAltitudeColor(150, range)
  const high = routeAltitudeColor(200, range)
  assert.notEqual(low, middle)
  assert.notEqual(middle, high)
  assert.notEqual(low, high)
  assert.equal(routeAltitudeColor(null, range), "#798993")
  assert.equal(routeAltitudeColor(100, { min: 100, max: 100 }), "rgb(226, 198, 71)")
})