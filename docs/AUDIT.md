# Audit and roadmap — Free Kick Simulator

Baseline taken from `freekick-simulator-main.zip` (2,904 lines: physics 906, render 587, app 741, tests 267).
Baseline tests: **29/29 pass**. Added in Stage 1: `tests/regression.test.js` (**9/9 pass**).
Run: `node tests/physics.test.js && node tests/regression.test.js`

## 1. Strengths to preserve
- `physics.js` is DOM-free, SI-unit, deterministic (seeded RNG), and runs in Node. This is the right foundation.
- RK4 at 1 kHz (~850 steps/ms in Node); tests check energy, momentum, terminal velocity, step convergence.
- Magnus force is perpendicular to velocity (does no work); Reynolds-dependent drag; spin decay (measured 6.2 %/s); Sutherland viscosity; ISA density with humidity.
- Rigid-sphere bounce couples linear and angular momentum; sliding-to-rolling transition is correct for a hollow shell.
- Zero dependencies, no build step, deployable as static files.

## 2. Findings

### Physics (ranked by scientific risk)
1. **Sub-critical drag constant needs verification.** `CD_SUB = 0.346`. A secondary source quoting Goff & Carré (2009) gives
   `Cd = a + b/(1+exp((v−vc)/vs))`, a = 0.155, b = 0.346, vc = 12.19 m/s, vs = 1.309 m/s, i.e. sub-critical Cd ≈ **0.50**.
   The engine's transition width (RE_WIDTH) and centre match that fit, and its super-critical 0.155 agrees with Goff & Carré (2012), who measured ≈ 0.17.
   The engine may have used `b` as the *total* sub-critical value. **Not confirmed against the primary paper** (paywalled; I could only read a student
   paper citing it and the 2012 open-access follow-up, which does not state the sub-critical value). Measured sensitivity: fast shots (>14 m/s throughout) barely
   change; a slow high lob's flight time moved 3.03 s → 3.42 s. Action: read the primary source, then change the constant *and* regenerate the golden values deliberately.
2. **One generic ball.** Cd/Cl/spin-decay/knuckle are one set of coefficients; README says they are "empirical fits", not measurements of a specific ball. Fine as a baseline, but the
   Ball Laboratory cannot honestly differentiate Jabulani vs Brazuca until per-ball parameter *ranges* are sourced (Asai et al. 2007; Barber & Carré 2010; Goff & Carré 2010).
3. **Lift curve** `Cl = S/(2.32 S + 0.4)` saturates sensibly (≈0.32 at S = 0.5, consistent with Goff & Carré's Teamgeist result of ≈0.35), but I could not attribute the exact form to a paper. Treat as "empirical, plausible", not "published".
4. **Knuckle model is phenomenological**: sum of two sinusoids in path length plus accumulated-rotation phase, amplitude 0.13 × spin-suppression × supercritical gate. Over 25 m at 31 m/s it produced a
   lateral crossing spread of sd 0.17 m (range ±0.24 m, 40 seeds). I did **not** verify whether that amplitude matches published knuckle measurements; it should be calibrated before being presented as realistic.
5. Wind is uniform with height (no boundary layer); the foot is not modelled (launch speed and spin are set directly); the keeper's "read" is a noise model, not perception science.

### Rendering
- Hand-written WebGL2: sky shader, analytic ground shadows (≤20 capsules; no shadow maps), Lambert + a crude specular term. No PBR, no IBL, no tone mapping, no shadows on stands/net.
- Stadium = 4 flat quads + procedural crowd shader; no floodlights, roof, or architecture. Goal net is a line grid (good deformation model, thin look).
- Ball shader draws the 12 pentagons only (no seams/hexagons, no panel normals). Ball orientation *is* driven by the integrated spin quaternion — keep that.
- Players are capsule figures.

### Application / architecture
- `app.js` is a 741-line IIFE mixing state, UI, charts, cameras and the loop; renderer and physics are cleanly separated, the app layer is not. Globals `FK`, `FKRender`, `FKSound`.
- 6 cameras; "follow" uses velocity direction with exponential smoothing and snaps when speed < 2.5 m/s; no offset control, no look-ahead, no scrub, pause-and-orbit only in Orbit mode.
- Per-frame allocations: `new Float32Array(sh)`/`(shp)` in the ground pass, ribbon colour closures and arrays in `buildRibbons`. Harmless today; will matter once more is drawn.
- No scene/cinematic timeline, no data layer, no ball-model abstraction.

### Performance
- Not measured in a browser (no headless GPU in this environment). Physics cost is negligible. Expected bottleneck is the ground fragment shader (20-iteration shadow loop + 2 noise octaves at full DPR ≤ 2).

### Missing vs the brief
Science Lab, Ball Lab, Experiment Lab, cinematic mode, 20-kick exhibition, force-vector overlays, impact model, bibliography, ball-specific parameters, camera set (goalkeeper, side, physics), fullscreen mode.

## 3. Roadmap (dependency-ordered)
| Stage | Deliverable | Gate |
|---|---|---|
| 1 ✅ | Audit, baseline, golden regression tests | 29 + 9 tests green |
| 2 (partial) | **Done:** camera system in `js/cameras.js` (keeper, side, physics cameras; follow offset + look-ahead; pause-and-orbit the ball), 18 unit tests. **Not done:** ball panels/seams, stadium, lighting, `app.js` split, any visual check in a browser. Original: Split `app.js` into modules (state / cameras / charts / ui); camera system (keeper, side, physics, follow offset + look-ahead, scrub-and-orbit); ball panel geometry + seams; stadium pass | physics tests untouched; browser check at 1080p and a tablet size |
| 3 ✅ (engine) / ⚠ (overlay unseen) | `forces()` API on the engine returning gravity/drag/Magnus/knuckle vectors per step, so overlays consume real engine output | test: sum of returned forces / m == `_deriv` acceleration |
| 4 | Ball model registry with `{value, source, confidence}` per parameter; Ball Lab UI | no parameter without a citation or an explicit "estimated range" label |
| 5 | Experiment Lab (paired runs, overlays, graphs, CSV) | every comparison uses `Simulation` |
| 6 | Cinematic timeline engine, then Scene 1–6 for one kick | narration synced to engine time |
| 7 | Historical records (sourced facts only, estimates labelled), 3 case studies, then scale | each entry: citations; parameters tagged *estimate* |
| 8 | Optimisation, cross-browser, docs, bibliography | |

## 4. Risks
- Presenting un-sourced coefficients as measurements (mitigation: confidence tags, Stage 4).
- The 20-kick exhibition requires per-kick research and footage-informed estimates; this cannot be done responsibly in one pass.
- No browser available here: visual work must be verified by you in Chrome/Firefox/Safari until a headless runner exists.

## 5. Stage 2 status (honest)
Camera maths is tested in Node. The wiring in `app.js`/`index.html` passes `node --check` but has **not been run in a browser**; test it by opening `index.html`, pressing 7/8/9, moving the Camera sliders, and pausing mid-flight (P) then dragging.

## 6. Stage 3 status
`Simulation.forces()` returns gravity, drag, Magnus, knuckle and contact forces (N) from the integrator's own derivative; `tests/forces.test.js` (9 tests) checks they sum to m·a, that drag opposes relative airflow, that Magnus is along ω×v and does no work, and that magnitudes match `aero()`. The on-screen vector overlay (Physics panel → *Show force vectors*) is wired through the existing ribbon renderer but **has not been viewed in a browser**.

## 7. Stage 2 rendering status (verified in headless Chromium + SwiftShader, no console errors)
**Done and seen:** 32-panel football (12 pentagons + 20 hexagons, layout checked: each pentagon has 5 hexagons at 37.38°) with sunk seams, puffed panels, specular and rim light, on a 72×40 mesh;
evening-match lighting (dusk sky, haze, floodlit pitch pool, stronger mow stripes); second stadium tier, concourse, back walls; force-vector overlay rendered correctly.
**Built but not yet seen in any screenshot:** roof ring, lamp rows, four corner floodlight masts (the cameras so far sit inside the bowl).
**Not done:** shadow maps, PBR materials, player models, net thickness, goal-net/post detail, textures from images, performance measurement on real GPUs (SwiftShader is software rendering).

## 8. Stage 5: goalkeeper, people, takers, surroundings (verified in headless Chrome + SwiftShader, no console errors)
**Goalkeeper physics (js/physics.js).** The old model moved the gloves straight toward the predicted point at up to
6–7 m/s and let a scripted fall start 0.2 s after arrival, so the hands hung at a top-corner target and a low drive
was only an arm extension. It is replaced by a body with centre of mass, body angle and arms: ready → (set) → push →
air → down/stand. In the air the centre of mass is a projectile (tested: vertical acceleration is exactly −g at every
step). Launch velocity is fixed at take-off from the read of the shot, and only the arms and body angle keep adjusting
in flight. Take-off is delayed when there is spare time so a high ball is met near the top of the jump. The ground
constrains feet, head and gloves. Catches require a low ball speed *relative to the gloves*, and a caught ball comes
down with the keeper. `tests/keeper.test.js`: 8 tests. The Monte Carlo golden value was regenerated on purpose; the
ball-flight goldens are unchanged.
**People (js/people.js, pure).** Forward kinematics for outfield players, two-bone IK for the keeper's legs and arms
(dressed exactly on the physics body, with the shoulders rolling toward the reach) and for the wall's hands. The
kicker has a keyframed run-up and strike, solved so the boot meets the back of the ball at t = 0. `tests/people.test.js`
(5 tests): contact alignment for every taker at three spots, no foot below the grass, constant limb lengths, keeper
gloves within 10 cm of the physics glove point, and wall feet.
**Rendering.** Lofted torso with kit patterns and seven-segment shirt numbers, tapered limbs, calves, boots, faces,
hair styles and beards; cloth, skin and hair shading; hemisphere + key lighting driven by Day / Sunset / Night presets
(clouds, sun disc, stars); an open far end with a forest (≈400 trees) and a ring of hills; meadow beyond the stands;
grass-blade detail. Ten cameras (new: Taker).
**Not done / limits:** players are still built from primitives (no skinned mesh, no faces beyond simple features).
Collision shapes for wall players are unchanged capsules. The taker animation is visual only and does not set launch
conditions.
**Performance (measured on an Intel UHD laptop GPU, 1536×1152, broadcast camera, GPU time per frame):** stage-4 build
16.9 ms; first stage-5 build 45 ms (about 360 small draw calls for the people, and full-screen ground and sky
shaded behind the stands). Fixes: people drawn with instancing (one call per primitive shape), ground and sky drawn
after the opaque geometry so hidden pixels are skipped, a bounding box on the shadow loop, and the forest drawn
behind the stands. Result: 21.5 ms per frame.

## 9. Stages 6–8: illustrated style, labs, story, exhibition (verified in headless Chrome and the app's browser)
**Illustrated style (default).** Ink outlines from an inverted hull pushed back along the view ray, three-tone shading
with pen hatching, a paper ground and sky, grey defenders, and swoosh lines following the real path of the kicking
boot. The keeper wears long padded shorts, the thighs are slimmer, and the eyes are smaller.
**Ball lab.** Per-ball drag-crisis parameters (`cfg.aero`), measured values from Hong & Asai (2014) for two panel
orientations. C_d below the crisis is not given per ball in that source, so it stays at the engine fit and is
labelled as such. The engine default is bit-for-bit unchanged (tested); the ball-flight goldens are unchanged.
**Experiment lab.** Seven experiments, all run through `FK.simulateFlight`, with overlays, graphs, a table and CSV.
**Anatomy.** Six scenes that drive the camera, speed and captions from live engine values (`aero()`, `forces()`,
the keeper state, `result()`). It was played start to finish in the app's browser by stepping the frame loop: all
scenes fire in order and there are no errors. Story kicks are not scored.
**Exhibition.** 6 kicks so far, not the 20 the brief asks for. Each has documented facts with sources (press
reports, UEFA), and every reconstruction is tagged as an estimate. Tests check sources, sections, that each
reconstruction reaches the goal mouth, and that the reconstruction distance is within 3 m of the documented one.
**Performance (Intel UHD, 1536×1152, broadcast camera):** about 19 ms per frame in the illustrated style and about
18 ms in the realistic one (stage 4: 17 ms). Cheaper instanced normals, fewer sphere segments, no grass noise on paper.
**Not done / limits:** only 6 of 20 exhibition kicks. The reconstructions do not guarantee that the original
outcome happens again: the keeper is simulated. Players are built from primitives, not a sculpted mesh. The open
question about the drag constant in §3 is unchanged. Voice narration uses the browser's speech engine where available.

## 10. Stage 9: sculpted players, ball designs, impact physics, 12 recreations, interface (verified as above)
**Players.** `js/sculpt.js`: one continuous anatomical tube per limb, rebuilt each frame along the skeleton, with
quadriceps, a slim knee, calf, deltoid, biceps and forearm profiles, and shorts, socks and sleeves painted per vertex.
The head is sculpted (jaw, chin, nose, brow, eye sockets, cheekbones, ears) with eyes, brows and lips. Hair comes in
short, buzz, long and bun styles, and there is a beard. Hands have thumbs; keeper gloves and boots with soles are
sculpted too. A bug that collapsed the forearm (limb "front" hint parallel to the bone) was found in screenshots
and fixed. `tests/sculpt.test.js` has 5 tests.
**Ball designs.** The shader draws four panel layouts (classic 32-panel; six-panel pinwheel; eight-panel with
curved triangles; six-panel with dark graphics), selected with the ball model. These are generic designs: no
trademarks are reproduced. A close orbiting "ball" camera is used in the Ball lab.
**Impact physics.** `FK.strikeFromBoot`: a point-impulse collision with restitution, effective ball mass at an offset
contact, and angular impulse ω = J·d/I. Typical output: ball/boot speed ≈ 1.18, and 2 cm off-centre gives ≈ 10 rev/s.
3 new tests. The spin is an upper estimate, because the model ignores foot deformation and rotation.
**Exhibition: 12 kicks** (was 6). Each has a documented goalkeeper, the wall where a source records it (only the
1997 France wall incl. Zidane is documented in the sources found; the others say so), and how the goal went in. Kits
use national or club colours, approximately. Recreations score: the keeper's random read is chosen from the seeds
under which a clean goal (no keeper or wall touch) happens, and a test checks that one exists for every kick. The
2002 recreation starts the keeper 2 m off his line (an estimate of the documented position). All 12 were played
start to finish in the app: 12 goals, with name tags shown.
**Interface.** New design system: a paper theme with the illustrated style and a dark glass theme with the realistic
one. Inter and Fraunces typography, custom controls, underline section tabs, a floating dock, editorial case-study
layout, and charts that follow the theme.
**Performance (Intel UHD, 1536×1152):** about 22–24 ms GPU per frame with the sculpted bodies; limb ring counts
reduced afterwards.
**Limits:** 12 of 20 kicks. Wall line-ups are rarely documented, so they are mostly unnamed. People are still
procedural meshes without textures or skinning weights, not scanned or motion-captured models.

## 11. Stage 13: smooth motion and per-player builds

**Twitching.** The cause was the retarget: matching each bone's full orientation to the simulated body made the
forearms and shins flip about 180° around their own axis whenever the body's side vector crossed over, frame to
frame. Bones are now turned by the shortest arc from their rest direction (parent first), so they cannot spin
round their own length. The run-up was also smoothed: the turn from standing to running, the pelvis and arm
swing ramp in and out, the kicking foot's path has no sharp corners, and the instep turn is blended.
Measured with a frame-by-frame check at 120 fps over a whole kick (Beckham, Messi, R. Carlos): no bone turns more
than 12° in one frame, except R. Carlos's kicking thigh at the moment of the whip (13–14°, about 1,600°/s, which is
realistic for an instep strike).
**Builds.** Each player has a build factor that slims or broadens the body around its skeleton before skinning
(head unchanged): Messi and Nakamura 0.84, Pirlo 0.86, Ronaldinho 0.88, Beckham and Juninho 0.9, Bale 0.93,
Ronaldo, Koeman and Mihajlović 0.95, R. Carlos 0.97. Wall players vary between 0.9 and 1.0, keepers 0.96.
**Limits.** The players share one CC0 base mesh with per-player skin, hair, beard, kit and build. They are not
likenesses of the real people: that needs scans or licensed models. The base mesh is barefoot, so boot toes show
the toe shapes faintly.

## 12. Stage 14: realistic bodies, team kits, goalkeepers

**Bodies.** The cartoon base mesh is replaced by MakeHuman CC0 data. The base mesh hm08 (13,380 vertices) is shaped
for each player by blending shape targets. Body targets set muscle, weight, height, proportions and ethnicity; face
targets set head shape, jaw, chin, cheekbones, nose and lips. There are 18 bodies: 11 takers, 6 wall players and 1
keeper. All use the game-engine skeleton with MakeHuman's own skin weights (53 bones, the same bone names as before),
so the retargeting is unchanged. These are approximations chosen from photos, not likenesses: no scans are used.
**Kit and hair as geometry.** Fabric is sculpted into the body: the torso and thighs are smoothed and inflated, the
sleeves and shorts flare at the hem, the collar is round, and the boots are smoothed so no toes show (keepers get
padded gloves). Short hair, slicked hair, long hair (covering the ears) and beards are shells grown from each
player's own scalp and jaw, so they fit every head exactly. Their edges thin out strand by strand. A bun is added for
Bale. Skin, eyebrows, hairline shadow and eyes are painted procedurally in the UV layout.
**Kits.** Every recreation now sets the taker's kit explicitly to his team of the day, with collar and cuff trim
and the shirt number. Portugal 2018 (red, red, green socks; Spain in near-white) and Barcelona 1992 (orange with
blue trim) were checked against kit archives; the others use the usual home colours. A test checks that all 12 have a
full attacking kit.
**Goalkeepers.** Recreations whose keeper is documented as not moving (David James 2008, De Gea 2018) set
`keeperRooted`: the keeper watches the ball in instead of diving. A test confirms every recreation still scores.
**Motion.** The twitch check (120 fps, whole kick) on the new rig: no bone turns more than 12° in a frame, except
R. Carlos's kicking thigh at the whip (13–14°). An extra key at the kicking foot's lift-off was tried; it made the
backswing faster and jerkier, so it was reverted.
**Camera.** The behind-the-ball camera steps aside when a long run-up starts under it. A head-and-shoulders
`#cam=portrait` view of the taker was added.
**Limits.** Faces are recognisable types, not the real people. Long hair ends at the jaw and nape (no shoulder-length
hair). Wall players in recreations are generic bodies in the team's kit.

## 13. Stage 15: photo skin, real hair, eyebrows, eyelashes, eyes

The previous bodies had procedural skin and hair shells, and the user judged them "awful". They now use the MakeHuman
CC0 system assets, fitted to each player with MakeHuman's proxy method: each vertex is a barycentric blend of three
body vertices plus a scaled offset, and its skin weights are blended from the same three vertices.
- **Skin:** photo-based textures in four tones, tinted to each player's skin colour against the texture's own face average.
- **Hair:** real hair meshes with strand textures. Messi short04, Ronaldo short02, Beckham short01, Koeman short03,
  Pirlo and Ronaldinho long01, Nakamura bob02, Bale ponytail01; the wall players and keeper vary. Hair colour comes from
  the player, normalised by each texture's own mean, so blond stays blond.
- **Eyebrows and eyelashes:** textured cards. Beards and buzz cuts are still shells, now with a fur texture whose
  edges fade out strand by strand.
- **Eyes:** the high-poly eyes with an iris texture. The transparent cornea layer is dropped.
- **Rendering:** hair, brows and lashes are alpha-tested and drawn with alpha-to-coverage on the multisampled canvas,
  so their edges are soft.
- **Kit:** the jersey is smoothed much more (no chest anatomy through the shirt) and hangs looser at the belly. The
  sleeves are slimmer. The fabric folds are fixed to the body in its bind pose, so they no longer slide over the
  shirt as the player moves.

Asset size: `assets/players.js` is 7.0 MB. All 103 tests pass; checked in headless Chrome in both styles.
**Limits:** the faces are realistic people of the right type, not the actual players' faces. MakeHuman has no beard
meshes, so beards are shells. Long hair ends at the shoulders.

## 14. Stage 16: stylized, polished players

The photo-skin players of stage 15 were judged "even uglier than before": photo skin and real hair cards on
approximate faces land in the uncanny valley. The user chose a stylized look, so the players are now consistent
cartoon figures on the same MakeHuman bodies and rig (motion and kits unchanged).
- **Cel shading** (`uToon` in the skinned shader): two clean light tones, cool shadows (warm on skin, with a softer
  terminator so faces are not split in half), a thin rim light, one crisp highlight band on hair, glossy eyes and
  boots, and a contact shadow near the grass. No skin mottling, micro relief or strand noise.
- **Outlines:** every player gets an inverted-hull outline in a dark shade of each part's own colour in the Stadium
  look (half the illustrated pen width); the Illustrated look keeps its black ink.
- **Hair and beards:** solid sculpted shells grown from each player's scalp and jaw, with lock ridges radiating from
  the crown, smoothed, and a clean edge where the painted hairline takes over. Every player carries every style.
- **Faces:** flat painted skin with soft lips and a dark upper-lid liner, bold solid eyebrows, cartoon eyes (big flat
  iris, dark ring, catchlight). Heads are 7 % bigger, blended by the head-bone weight so the neck stays smooth.
- **Faces against the sun:** skin, hair, beards and eyes take their key light leaning toward the camera (as in
  animation), so a backlit player's face stays lit instead of showing large dark patches.
- **Fix:** forearm and shin region positions now run from 1 to 2, so triangles at the elbow and knee no longer
  pick up stray sleeve or shorts paint (new test in `tests/rig.test.js`).

Asset size: `assets/players.js` is 3.3 MB (no photo textures or hair cards). All 103 tests pass; checked in headless
Chrome in both looks (portraits and run-up). **Limits:** the faces are stylized types, not likenesses.

## 15. Stage 17: posture, body shape, faces

- **Head level:** the model's neck slants ~19° forward, but the retarget aimed it straight along the spine, so every
  head tipped back, chin up. The neck now keeps the model's own slant in the body's frame.
- **Shoulders:** the arms start at the model's own shoulders (the simulator's shoulder points were ~6 cm higher and
  narrower: shrugged shoulders, squashed chest) and are solved with the model's bone lengths to reach the body's hand.
- **Feet flat:** the model's ankle→ball bone slopes 25° down on a flat sole; aiming it level tipped every foot
  toes-up with the soles showing. Peak foot turn in the follow-through is now 12–16°/frame at 120 fps (was <12).
- **Hands relaxed:** palms turned toward the thighs (slightly back), fingers gently curled, hanging hands kept off
  the shorts. `poseRig(..., relax = false)` keeps the bind hands (used by the bind-pose test).
- **Legs:** hips at the model's own width, knees most of the way, ankles where the body plants them (no knock knees).
- **Faces:** six Taubin smoothing passes over the face (eyes, lips and ears kept) remove the faceted planes that the
  cel shading broke into patches. Shirts and faces take their key light leaning toward the camera.

## 16. Stage 18: movement

Checked frame by frame in headless Chrome (side-on camera `#cam=track`, keeper camera `#cam=gkfront`).
- **Running stride:** the swinging foot now rises behind the hips first (heel kick, knee flexed), then the knee drives
  through and the foot comes forward low to land. It used to move forward and up together, so the leg reached out
  straight in front like a goose-step.
- **Standing:** the hips sit where nearly straight legs reach the grass (≈20° of knee bend instead of ≈40°), at the
  mark and after the kick. The hip-height limit had also checked each foot against both hips, so the far hip held
  the body low.
- **Follow-through:** the kicking foot lands sooner (0.4 s), the body carries on to end over its feet, and the taker
  rises to full height. Previously he squatted on the standing leg, then stood on bent knees until the next kick,
  with the kicking foot hovering ~8 cm above the grass (its landing point counted the ankle height twice).
- **Arms and hands:** arms keep the body's own angles from the model's shoulders (reaching for the body's hand point
  from there straightened the forward arm); hands close into loose fists when the elbow is bent. Only the goalkeeper
  reaches for exact hand points (`gloves: true` from `keeperBody`).
- **Goalkeeper:** once the ball is 0.15 s past the line, the body keeps its dive and tips onto its side as it falls,
  instead of turning to point at the crossing point above him (which swung him upright and dropped him feet-first).
  Seeded outcomes and Monte Carlo tallies are unchanged.

All 103 tests pass. Joint-acceleration spikes are at the previous baseline; peak foot turn in the fastest
follow-throughs is 12–16°/frame at 120 fps (Carlos), finger bones ~13° when the balance arm flings out.

## 17. Stage 19: face likeness (stylized)

The MakeHuman face targets available here are limited (no ears, eye size or face length), so the builder now adds
its own soft, landmark-based sculpting per player (`FACE` in `tools/build_players.py`): ears, jaw width, face
length, eye size, lip push, brow ridge, cheek width, nose size and chin push, around landmarks found on each head
(eyes, mouth, chin, nose, ears). Values are approximations from public photos, leaning toward caricature so each
player reads at a glance, not likenesses or scans.
- **Eyebrows per player:** the brow texture now stores a thickness field and the shader cuts it at each player's
  own weight (`browW`: thin and groomed for Ronaldo … heavy for Mihajlović).
- **Hair per player** (`HAIRMOD`): Ronaldo's quiff with faded sides, Beckham's short top, Messi's fringe, fuller long
  hair for Pirlo, Ronaldinho and Nakamura. Long hair is smoother, with gentle waves and less flare over the ears.
- **Colour:** Beckham's and Koeman's blond toned down; faces in shadow use a lighter, warmer shade.
- **Portrait camera** now looks at the taker's face (he faces the ball at the mark).

All 103 tests pass.

## 18. Stage 20: faces matched to reference photos

Tuned against the user's reference photos (Ronaldo 2008, Messi 2019, Ronaldinho 2002, Bale 2022, Roberto Carlos 2002,
Beckham 1998), still stylized:
- **Hair shells subdivided** (scalp 4×4, long hair and beard 2×2) so hair can carry detail: Ronaldo's gelled spikes
  with tight sides, Messi's swept-up top with short sides, Ronaldinho's curly locks, Beckham's fuller centre-parted
  hair (`spikes`, `part`, `locks` in `HAIRMOD`).
- **Ronaldinho's headband:** a thin white band painted in the head's bind frame (`uBand`), over hair and forehead.
- **Roberto Carlos:** lighter brown skin, a shaved head (painted scalp shadow, `hairStyle: 'shaved'`), heavier brows,
  bigger ears.
- **Beckham:** light-brown hair instead of bright blond, longer, narrower face. **Messi:** fuller beard.
Asset size: `assets/players.js` is 5.9 MB. Open-mouth expressions are not possible (the face mesh has a closed mouth).

## 19. Stage 21: livelier, more human movement

- **Shoulders turned the wrong way while running:** the trunk twist had the opposite sign to the arm swing, so the
  shoulder of the forward-swinging arm went back. Now the shoulder goes with its arm (correlation +0.7…+0.98).
- **Hips counter-rotate:** the pelvis has its own frame (`body.P`) that turns with the forward leg, against the
  shoulders, and takes only a third of the trunk's lean. The rig bends the spine in stages (spine_01/02/03 at
  40/72/100 % of the way from pelvis to chest) instead of pivoting the whole torso at the hips.
- **Head held level** (`body.H`): it looks ahead and stays level against the lean and twist while running.
- **Weight shift:** the hips move ~2 cm over the stance foot each step. Runner's arms: elbows near 90°, closing as
  the arm drives forward.
- **Nobody stands frozen any more:** an animation clock (stops when paused) drives breathing, weight shifts, small
  trunk turns and glances for the taker at the mark and every wall player (each on his own phase), and a small bounce
  and sway on his toes for the keeper while he waits (visual only; physics unchanged). The run-up starts 0.4 s
  earlier so the idle motion fades out without a snap.

All 103 tests pass; seeded outcomes unchanged; joint-acceleration spikes at or below the previous baseline.

## 20. Stage 22: free-kick technique and a springier run

The strike follows the biomechanics of the instep / curling kick:
- **Tension arc and release** (`keyed` in `kickerBody`): as the leg cocks, the kicking hip rotates back (pelvis up to
  22° toward the kicking side) while the shoulders turn the other way and the opposite arm swings out wide and back.
  Through contact the hips whip through and past the target, the shoulders unwind against them, and the arm sweeps
  forward and across. The kicking-side arm counters the leg.
- **Technique per taker** (from the kick label): `curl` (inside of the foot: toes turned out, ankle beside the ball,
  trunk leaning back and away, the leg wraps across the body), `knuckle` (instep, toes down, ankle locked, chest over
  the ball, short straight follow-through), `outside` (Roberto Carlos: toes turned in, the leg swings out), `instep`
  (driven and dipping shots).
- **Head:** eyes on the ball through the last strides and the contact (yaw and pitch toward it), then up after the
  shot. The standing knee flexes a little more at contact.
- **Run:** toe-off (the heel rises and the foot rolls onto its toes at the end of each stance, carrying into the
  swing), the swinging leg's hip drops slightly, and a springier vertical bounce.
- The boot-reaches-the-ball test now measures the nearest point of the foot (a curler meets the ball with the side
  of the foot, toes beside it).

## 21. Stage 23: a natural run and a goalkeeper whose limbs move apart

Run (measured per frame with a gait trace before and after):
- **Arms swing from the shoulder.** Before, both hands stayed folded in front of the chest (the back hand never went
  behind the hip). Now the elbow opens as the arm swings back (hand ~15 cm behind the hip) and closes as it drives
  forward (hand to chest height).
- **The bounce was upside down:** the hips peaked at touchdown. They are now lowest at mid-stance (the knee flexes
  ~40° to absorb the landing) and highest in the flight between steps.
- **Ground contact** is about a third of each stride (0.2 s for a jog, shorter for fast runners so the foot is never
  left far behind the hips). It was 0.13 s, which read as a series of hops.
- **No overstride:** the foot lands ~17 cm ahead of the hips (was ~34 cm, braking with a straight leg). Over the last
  two strides the hips sit back and sink into the plant, so the strike itself is unchanged.
- **The swinging foot comes through under the body** at the top of its arc with the knee driving forward. Before, an
  extra-slow start left it hanging ~65 cm behind the hips.
- Small trunk rock over each stance foot and a little forward pitch at mid-stance.

Goalkeeper:
- **Dive shape:** the dive-side leg trails nearly straight (it pushed last) and the top leg tucks with the knee driven
  forward. Before, both legs tracked one point and moved as one block. The shape blends in through the push, holds in
  the air and relaxes once he is down.
- **Hands:** at full stretch the top hand leads and the lower one trails a few centimetres behind it.
- **Shuffle steps:** in the set and reach positions the feet step (each alternately stands and catches up, lifting as
  it moves) instead of sliding together.
- **Head** follows the ball (within what a neck allows).
- **Physics:** after a dive he no longer lies on the grass for good. Once he has stopped sliding and the ball has gone,
  he gets up (`getup` state: the body turns upright about the feet), and his arms come down instead of reaching for
  a ball that has already passed. Saves and goals are unchanged (the get-up starts 0.4 s after the ball arrives).

All 103 tests pass; joint-acceleration spikes at the previous baseline (only the known strike-time spikes).

## 22. Stage 24: real motion capture for the taker and the wall

The user judged the hand-tuned movement "still ugly" across the run-up, the kick, the keeper and standing. With their
approval the taker now moves with real recorded motion from the CMU motion-capture database (see `assets/CREDITS.md`).

- **Run-up:** a recorded jog stride (16_35, 2.8 m/s), played at each taker's speed with the rate set so planted feet
  stay still, on a path along his own approach line that curves onto the recorded kick's run-in over the last second.
  The path is integrated back from the kicking foot's last touchdown so it lands exactly where the recorded kick
  lands it. He sets off from the recorded standing with a 0.45 s speed ramp.
- **Kick:** recorded run-in instep kicks (10_03 for curlers, 10_05 for knuckleballs, 10_06 for driven and outside-foot
  shots), placed with the ball at the recording's contact point and +x along the shot, mirrored for left-footers. The
  run blends into the kick while the kicking foot is planted in both, so nothing slides. Curlers and the outside-foot
  strike keep the technique foot-turn overlay. After the recording ends he settles into the recorded standing.
- **Body rebuild:** each frame is rebuilt on the player's own proportions: legs and arms by two-bone IK toward the
  recorded ankles and wrists (pole = recorded knee/elbow, slightly biased so a straight limb never flips), pelvis, trunk
  and head frames from the recorded hips, spine and neck, hips at the recorded height, and the body lowered only if a
  planted foot would be out of reach. Limb lengths stay exact.
- **Wall:** each defender stands with the recorded standing (on his own clock), hands still covering, blending into the
  procedural tucked jump as he leaves the ground.
- **Keeper:** unchanged from stage 23 (the CMU library has no goalkeeping).
- The procedural taker is kept as `kickerBodyProc` and is used if `assets/mocap.js` is missing.

All 103 tests pass (boot within 0.10-0.15 m of the ball centre at contact for every taker). Joint-acceleration spikes:
the kicking foot's touchdown each stride (a real impact in the recording).

## 23. Stage 25: a human goalkeeper, celebrations, and real-time shots

**Goalkeeper reads like a person, not a computer.** Before, at his reaction time he predicted the exact flight,
curl and dip included, and saved 84% of on-target corner free kicks (a pro keeper over a wall of 4, all eleven
signature kicks from 21-29 m, six corner targets). Now:
- **Partial read of the bend:** his decision uses his own prediction with only part of the Magnus force
  (`level.read`: amateur 0.2, pro 0.4, world class 0.55), plus his error. The rest of the curve becomes visible to
  him late (blended in as (elapsed fraction)^1.6), but once airborne only his arms can follow it. He also judges
  "on target or not" from his own read, so a curler that starts wide is left alone.
- **The wall screens the strike:** with a wall he reacts no earlier than 0.1 s after the ball clears it.
- Result on the same set of kicks: pro 65% saved (35% of on-target shots scored), world class 76%. Curlers now beat
  him (Messi 8 goals → 23, Beckham 7 → 14, Pirlo 11 → 25, Nakamura 7 → 23); knuckleballs and driven shots he can
  read are still mostly saved. The seeded Monte Carlo golden was regenerated deliberately.

**Celebrations** (`celebrate` in `js/people.js`, `CELEB_OF`): after a goal the scorer finishes his follow-through,
sprints toward the crowd behind the free kick (recorded jog) and celebrates. Ronaldo: Siuuu (jump with a half-turn,
land wide, arms thrust down). Messi, Juninho: pointing to the sky. Roberto Carlos, Koeman: knee slide. Beckham,
Mihajlović: "can't hear you". Pirlo: calma. Ronaldinho: shaka. Nakamura, Bale: penguin belly slide. Standing
gestures sit on the recorded standing with the arms placed by IK; the slides and the jump are posed on the same
skeleton, and blended bodies have their limbs re-solved at their true lengths. The camera goes to him ('celebrate'
view) unless the orbit camera is in use, and a toast names the celebration. Not in replays.

**Shots run in real time at any frame rate.** The frame step was capped at 0.05 s, so below 20 fps every shot
(and the run-up) played in slow motion. The simulation, run-up and animation clocks now advance by real elapsed time
(up to 0.25 s per frame); only camera smoothing keeps the small cap. After the shot ends the taker's clock keeps
running, so he no longer freezes mid-motion.

All 103 tests pass.

## 24. Stage 26: goalkeeper movement and stronger likenesses

Goalkeeper movement, from filmed dives (low drive, top corner, mid-height curler):
- **No turning round in mid-air.** His body angle is committed at take-off (`diveLean`); in flight it may adjust by
  at most 0.3 rad toward a late read. Before, a late read of the curl swung him upright mid-air and he fell feet first.
- **Low balls: collapse, not a hop.** A dive to a ball under 0.9 m may push down and sideways (launch speed down to
  -1 m/s). The forced minimum hop floated him flat about 0.6 m above a low drive going in underneath.
- **High balls: timed jump.** To a high ball the lateral flight is capped near his rise time (vUp/g × 1.3), so he is
  near the top of his jump when the ball arrives. He used to take off early, hang about 0.65 s and land before the ball.
- **No snapping between states.** Forward lean and the hands leaving the set position ease over ~0.1 s (they switched
  in one frame between set, push and air). Set position: hands low and wide, about thigh height.
- Save rate on the stage 25 benchmark: pro 63% of on-target shots.

Likeness: the per-player face sculpt is roughly doubled (jaw, face length, cheeks, nose, eyes, ears, lips, brow, chin)
and the named players' MakeHuman face shapes are applied at 1.4×; signature hair is stronger (Ronaldo's quiff,
Beckham's curtains, Ronaldinho's volume and locks, Nakamura's fringe, Pirlo's volume).

## 25. Stage 27: keeper arms, and the interface

Keeper: the two hands were assigned to the glove positions by a fixed side, so when the arm angle wrapped the arms
crossed (one straight up past the head, the other across the face). Each hand now goes to its own shoulder's side of
the ball. The head may tilt at most ~37° along his own body axis, so its up vector stays defined (it rolled over when
he looked along his trunk toward his hands in a dive).

Interface:
- The stadium is the default look (the illustrated paper world is still one click away).
- One dock at the bottom for everything used while playing: hide/show panels, the 4 cameras (Behind, TV, Ball, Goal;
  keys 1-4; the other views remain for the guided sections), replay, a large kick button, pause/resume and speed.
- Live controls: segmented controls and the section tabs have a sliding highlight; buttons press in; the kick button
  fills as the taker runs up, goes dark while the ball is in flight and pulses when the next kick is ready; pause
  turns into a glowing play button; panels slide away instead of vanishing; sound and help are icon buttons.

## 26. Stage 28: keeper hands and stance, the ball showcase, a quieter story

Keeper:
- **Hands:** a keeper's palms now face the ball (or the pitch while he waits) with the fingers open; they used the
  outfield "relaxed hand" (palm to the thigh, fingers curling with elbow bend).
- **Set position:** his waiting hands were placed in world left/right, but facing up the pitch his right is -y, so
  each hand reached across his body and the arms crossed in an X. They are now low and wide on his own sides, and he
  crouches (hips ~10 cm lower, knees bent).
- **Power step:** as he pushes off, the dive-side foot steps 22 cm toward the ball first.

Ball showcase (`js/ballview.js`, `js/showcase.js`): the Trionda spins as the logo; clicking it opens a card where the
ball grows out of the logo into a large 3-D view (drag to turn it), with tabs for Trionda, Brazuca, Jabulani and
the classic ball, facts on each, and "Play with this ball". The Trionda is the ball in play by default (its pattern
also added to the game ball; it flies with the engine drag model, as no wind-tunnel data has been published).

Real 3-D models: `tools/ball_model.js <id> <file.glb|.gltf|.obj>` converts a downloaded model to
`assets/balls/<id>.js` and lists it in `assets/balls/manifest.js`; the viewer then draws the model instead of the
panel pattern. Until models are supplied, the balls are panel-pattern recreations.

Story: the captions keep only the main facts in plain words (distance and wall; launch speed, angle and spin; speed
and bend in flight; the keeper's time; the result). Air density, the spin parameter, the Reynolds number and forces
in newtons are gone from the narration, and the kick-settings panel steps aside while the story plays.

## 27. Stage 29: painted World Cup balls

No free, downloadable 3-D model of the Trionda, Brazuca or Jabulani was found (they are on CGTrader, Sketchfab and
RenderHub behind accounts, most paid), so `tools/ball_textures.py` paints each ball's texture per pixel from its real
panel layout and the graphics in product photos (no maker's or FIFA logos):
- Trionda: four tetrahedral panels whose seams are swirled about the three-way meeting points into sweeping waves;
  wide white ribbons along the seams, gold edging, and on three panels a curved triangle of colour (red with leaf
  motifs, green with feather chevrons, blue with stars) with flowing contour lines; the fourth panel white.
- Brazuca: six propeller panels (cube faces with S-shaped edges); along one side of every seam a tapered swoosh of navy
  with orange / green / sky-blue edges, a slim navy line on the other side.
- Jabulani: eight panels with faint seams; four curved triangles with sharp points and concave sides, dark inside with
  thin diagonal stripes in the ball's colours, ringed in golden yellow and black.
The textures (2048×1024 JPEG, ~0.5 MB each) go to `assets/balls/<id>.js` as `{sphere: true, texture}`; the logo, the
showcase and the match ball itself (render.js samples it by direction, with seam-free gradients) all use them.
`BALL_PREVIEW=<dir>` makes the generator also write shaded sphere previews.

## 28. Stage 30: real ball models, a logo that follows your pick, interface sounds

- The owner supplied 3-D models of the Trionda (.glb), the Jabulani (binary FBX) and a classic ball (.glb).
  `tools/ball_model.js` now also reads binary FBX (7.x node tree, polygons fan-triangulated, normals and UVs by
  polygon vertex or control point, direct or indexed) and takes `--texture` to override the base colour.
  `tools/ball_bake.py` rasterises each model in longitude/latitude, interpolates its UVs per pixel along the ray, and
  bakes the texture onto the sphere map the game ball uses. The Trionda texture's grey base (its original shader
  brightened it) was levelled to white. The showcase shows the real meshes; the logo and the match ball use them too.
- The Brazuca is removed from the showcase and its painted texture deleted (no model was found); its wind-tunnel data
  stays in the Ball lab.
- The spinning logo becomes whichever ball the showcase shows, with a small pop.
- Interface sounds (`FKSound.ui`): soft sine chimes with a 6 ms attack through a low-pass and a light reverb — a tap
  for any button, a rising two-note chime for choosing in a set (cameras, speeds, tabs, takers), up/down glides for
  toggles (panels, pause, sound), a three-note confirm for Kick and "Play with this ball", an airy rise/fall for
  opening and closing the showcase. They respect the sound switch.

## 29. Stage 31: a round Trionda, an uncluttered interface, a voice for every control

- **Trionda:** the supplied model's panels bulge like pillows and its levelled texture washed the colours out. The
  design is now baked onto a perfect sphere (`ball_bake.py --seams --sphere-only`), with thin dark grooves drawn where
  the model's panels meet (detected as jumps between UV islands), and the texture levelled only where it is near-grey
  (the white base), so the red, green and blue keep their depth. The viewer's light is a soft studio key with a satin
  sheen instead of a glossy one.
- **Interface:** two slim rails replace the two always-open panels. Left: Player, Shot, Spot, Defence, Weather, More;
  right: Stats, Charts, History. Each opens one focused drawer beside its rail (titled, with ✕; Esc closes), one per side
  at a time; everything starts closed. A small live readout (speed, spin, height, time) stays top right. The look
  switch moved into Weather. The dock's first button now hides the whole interface (H).
- **Sounds** (all synthesised): a woody tap for plain buttons; pentatonic two-note chimes for choices in a set (pitch
  by position); a page swish for sections; each taker his own marimba note; preset plucks; airy slides for drawers
  opening and closing; up/down glides for switches; clicks for checkboxes; a punchy chord for Kick; a rewinding run for
  Replay; tape-stop / tape-start for pause and resume; whooshes for hiding and showing the interface; a shimmering
  arpeggio for the showcase, a crystal chime per ball and a success chord for "Play with this ball"; slider detents
  whose pitch follows the thumb; faint hover ticks on the rails and dock; a pluck for toasts.
  Turning things by hand — the showcase ball (and its coast after a fling), aiming on the pitch, orbiting — clicks like
  a fine dial (a detent every ~11°, quicker and brighter the faster), over a soft whirr that follows the speed.
  Match: a referee's trilled whistle starts each run-up; a crowd murmur (stadium look) builds through the run-up and
  peaks in flight.

## 30. Stage 32: the Trionda's colours on the right panels

The loose PNG shipped beside the Trionda model (`textures/ball951_c_bsm_alp_1.png`) is the vertical mirror of the
colour texture embedded in the .glb (pixel-identical once flipped). It had been used, so every colour landed in the wrong
place and the panel seams cut through the graphics. The ball is now rebuilt from the embedded texture (levelled as
before); its seams, from the model's own panel cuts (`ball_model.js --seam-uv 0`), run through the white ribbons as on
the real ball. `ball_model.js` gained `--uv N` / `--seam-uv M` (the model has two UV sets; both map the colour the same
way) and `ball_bake.py` draws seams from the seam UV set and no longer stores the sphere map twice.

## 31. Stage 34: celebrations switch, the keeper's eyes, grooves you can see, a wilder Jabulani

- **Celebrations** can be switched off: More → Match → "Goal celebrations", or the C key. The choice is remembered
  (localStorage); switching off also ends one that is under way.
- **Keeper camera** (dock button "Keeper", key 5): the view from the goalkeeper's eyes, taken from his head in
  `keeperBody` every frame. It crouches, shuffles and dives with him, always looks at the ball (back out at the pitch
  once the ball is past him), and carries a softened share of his head's roll into the horizon during a dive. The
  celebration camera does not take over while you watch through his eyes.
- **Experiments tab removed** (the Experiment lab code in `js/labs.js` with it). The Ball lab and the free-kick
  exhibition stay.
- **Ball relief.** `tools/ball_model.js` now keeps a model's normal map (glTF `normalTexture`, or `--normal` for
  FBX/OBJ). `tools/ball_bake.py` bakes it like the colour: per triangle it builds the texture's tangent axes from the
  UVs, lays them onto the sphere at every pixel and stores object-space normals by direction ("sphereNormal"). The
  green-axis convention (OpenGL/DirectX, and FBX/OBJ's flipped v) is detected as the one whose sideways tilt is
  curl-free, as a height field's must be (Trionda: curl/div 0.42 vs 1.20; Jabulani 0.14 vs 1.18). The game ball and
  the viewer tilt the normal by the map (×1.6), shade the grooves, and add a fine pebbled grain that fades out below
  pixel size. Trionda and Jabulani now show their panel grooves, raised graphics and textured skin.
- **Classic ball** is procedural, matched in game and viewer: seam grooves 1.3 mm deep (the normal tilts into the
  seam along the gradient of the panel-distance field), a smooth dome on every panel, stitch dimples along both sides
  of each seam (shown only when larger than a pixel), soft shadow by the seams, pebbled skin, faint scuffs. The viewer's
  hexagon centres were the wrong dual of its pentagons (panels looked like triangles); they now match the game.
- **Jabulani knuckle.** The knuckle force now takes per-ball parameters (`knCl`, `knSpin`, `knFreq`, `knTrans`;
  defaults reproduce the old model bit for bit). The Jabulani gets a stronger side force (0.27 vs 0.13), keeps knuckling
  with more spin, changes direction faster, and swerves harder while its flow passes through its drag crisis
  (Re ≈ 3.3×10⁵, about 23 m/s, at the end of a free kick). Over 40 seeded 31 m/s knuckleballs from 25 m the rms
  sideways spread at the goal is 0.35 m (max 0.55 m) against 0.18 m (0.25 m) for the other balls. These are model
  values, not measurements. `#ball=` now also applies the ball's aerodynamics.

## 32. Stage 35: Payet, a broadcast TV camera, the taker's eyes, a plain Ball lab

- **Free kicks:** Payet v Crystal Palace (Premier League, 2 April 2016, Upton Park, 41', about 25 yards, keeper Wayne
  Hennessey; sources: West Ham match report and "All Angles", Sky Sports report) added; Ronaldo 2018, Koeman 1992,
  Mihajlović 1998 and Nakamura 2006 removed (nine exhibits). Payet is a new taker (right foot, whipped curler) with
  his own MakeHuman body and face from `tools/build_players.py`, built last so every other player is byte-identical.
  Kits can now give sleeves their own colour (`kit.sleeves`; West Ham's sky-blue arms).
- **TV camera:** high in the main stand behind the ball (ball.x + 26 m, y = −34 m, 13 m up), long lens (fov 0.34),
  framed on a point 64 % of the way from goal to ball: goal top left, wall in the middle, taker bottom right, like a
  broadcast free kick. It pans gently after the ball once it is struck.
- **Taker camera** (key 6): through the taker's eyes, from his head every frame; over the ball toward the goal before
  the strike, then following the ball. The old front-side view is `#cam=takerside`.
- **Dock:** "Hide panels" has a label, lights up (accent, pulse) while the panels are hidden, and a one-time tip points
  to it. A "Clear" button (or X) wipes the lines of earlier kicks and lab paths; it is greyed out when there is nothing.
- **Ball lab:** the three playable balls, a plain sentence and three meters each (no-spin wobble, air resistance at
  108 km/h, the speed above which it turns slippery), "Play with this ball", "Race all three" (same kick and seed for
  each ball, drawn on the pitch) and "See it up close"; the drag chart and sources under "The science". Cafusa removed.
- **Text encoding:** `js/balls.js`, `js/people.js`, `tools/build_players.py` and `tools/mocap_build.js` had UTF-8 text
  decoded as Windows-1252 and saved again (comments and one source title showed "CarrÃ©", "â€“"); repaired run by run.
