import io
p='scripts/smoke-biobuzz/render.ts'
s=io.open(p,encoding='utf-8',newline='').read()

a = """                      for (const [which, stg, rim] of [['new', st, stand], ['bore', stBore, BB_FLOWER_OPEN_R]] as const) {
                        const am = bbBoxTubeAim(pivot, target, stg, rim);
                        const yawW = am.yaw + heading;
                        const ux = Math.cos(am.pitch) * Math.cos(yawW);
                        const uy = Math.cos(am.pitch) * Math.sin(yawW);
                        const uz = Math.sin(am.pitch);
                        const ox = r.pos.x + pivot.x * c - pivot.y * s;
                        const oy = r.pos.y + pivot.x * s + pivot.y * c;
                        const oz = pivot.z + (r.z ?? 0);
                        let pen = 0;
                        let gap = Infinity;
                        for (let ei = 0; ei <= 5; ei++) {
                          const e = ei / 5;
                          for (let i = 1; i < BB_BOX_TUBE_SECTIONS.length; i++) {
                            const halfW = BB_BOX_TUBE_SECTIONS[i] / 2;
                            const front = e * am.ext * i;
                            for (let k = 0; k <= 10; k++) {
                              const d = front - (k / 10) * stg.sectionLen;
"""
b = """                      for (const [which, stg, rim] of [['new', st, stand], ['bore', stBore, BB_FLOWER_OPEN_R]] as const) {
                        const am = bbBoxTubeAim(pivot, target, stg, rim);
                        const ox = r.pos.x + pivot.x * c - pivot.y * s;
                        const oy = r.pos.y + pivot.x * s + pivot.y * c;
                        const oz = pivot.z + (r.z ?? 0);
                        let pen = 0;
                        let gap = Infinity;
                        // ⚠️ THE POSE AT EASE `e` IS `e`·PITCH AND `e`·SWIVEL, NOT THE FULL AIM WITH
                        // A SHORTER ARM. `sync` writes `rig.pitch.rotation.y = -e * tubePitch` and
                        // `rig.swivel.rotation.z = e * tubeYaw`, so an arm half way out is also half
                        // way up. Sampling the full pitch instead put stage tails through the MID
                        // plate at poses the renderer never draws — measured, 1,205 of 13,104 false
                        // hits before this line was right.
                        for (let ei = 0; ei <= 10; ei++) {
                          const e = ei / 10;
                          const yawW = heading + baseYaw + e * (am.yaw - baseYaw);
                          const pit = e * am.pitch;
                          const ux = Math.cos(pit) * Math.cos(yawW);
                          const uy = Math.cos(pit) * Math.sin(yawW);
                          const uz = Math.sin(pit);
                          for (let i = 1; i < BB_BOX_TUBE_SECTIONS.length; i++) {
                            const halfW = BB_BOX_TUBE_SECTIONS[i] / 2;
                            const front = e * am.ext * i;
                            for (let k = 0; k <= 10; k++) {
                              const d = front - (k / 10) * stg.sectionLen;
"""
assert a in s, 'swept loop'
s = s.replace(a, b, 1)

c = """            check(
            'box tube: BB_FLOWER_OUTER_R covers the asset it was measured from, at every approach angle',
            worstUnder <= 0,"""
c2 = """          check(
            'box tube: BB_FLOWER_OUTER_R covers the asset it was measured from, at every approach angle',
            worstUnder <= 0,"""
d2 = """          // the table is a MEASUREMENT rounded to three decimals, so it may sit a thousandth under
          // the raw vertex it came from; `BB_BOX_TUBE_FLOWER_GAP` is 0.35, three hundred times that
          check(
            'box tube: BB_FLOWER_OUTER_R covers the asset it was measured from, at every approach angle',
            worstUnder <= 0.001,"""
assert c2 in s, 'pin check'
s = s.replace(c2, d2, 1)

e = """          '...at the flower\u2019s NEAR RIM, not its centre \u2014 the one argument that keeps it out of the column',
          /rig\.stages,\s*\n\s*BB_FLOWER_OPEN_R,/.test(robotsCode),"""
f = """          '...at the PLATE\u2019s outer edge in the approach direction, not at the bore \u2014 the one argument that keeps the arm out of the flower',
          /rig\.stages,\s*\n\s*bbBoxTubeStandoff\(theta\),/.test(robotsCode) &&
            robotsCode.includes('const n = FLOWER_MOUTH[f.wall];') &&
            !robotsCode.includes('BB_FLOWER_OPEN_R'),"""
assert e in s, 'rim src check'
s = s.replace(e, f, 1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
