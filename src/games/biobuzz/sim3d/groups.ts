/**
 * THE FOURTH COLLISION BIT: A DEPLOYED RAMP, AND THE ONE THING IT MUST NOT MEET.
 *
 * (`bodies.ts` holds the other three and the pairing rule; this is its own file only because
 * `bodies.ts` imports `flowerTube.ts`, and both ends of this pair need the constant.)
 *
 * A deployed ramp's blade rides 0.046 in over the FLOWER's lower ring plate (`BB_RAMP_FLOOR_Z`
 * 0.40 against a 0.354 plate top) — it has to, or it cannot get under a POLLEN. Owner report
 * 2026-09-21: "it kinda gets caught on the bottom aluminum part of the flower and makes the whole
 * robot jump upwards". MEASURED (`scratch/ramphop.ts`, 240 real drive-ins): 171 lifted the chassis,
 * up to 0.23 in at vz 10 in/s, with NO penetrating contact anywhere. It is a SPECULATIVE contact:
 * the blade's leading bottom edge against the plate's top edge is an edge-edge pair whose normal
 * is diagonal (−0.73 z), so the solver cancels the approach ALONG that diagonal — and a chassis
 * that cannot pitch takes the vertical half as a hop. No clearance the blade can afford fixes it
 * (it scales with speed: 0.5 in of gap at 60 in/s). A real ramp is hinged and would simply ride
 * up; this one cannot, so it does not meet the ring plates at all.
 *
 * What is NOT lost: the chassis still stops on the flower, the flower's posts and cage are other
 * colliders and still meet the ramp, the swing guard's query carries no groups so it still
 * refuses a deploy into a flower, and every element meets both.
 */
const GROUP_RAMP_BIT = 0x0008;
/** the deployed ramp's blade and rails: this bit ONLY, and they meet everything that accepts it. */
export const GROUP_RAMP = (((GROUP_RAMP_BIT << 16) | 0xffff) >>> 0) as number;
/** a FLOWER's ring plates: ordinary membership, and they meet everything but a ramp. */
export const GROUP_FLOWER_RING = (((0xffff << 16) | (0xffff & ~GROUP_RAMP_BIT)) >>> 0) as number;
