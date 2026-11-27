<div align="center">

# ⚽ Free Kick Simulator

**A physics-based 3D football free-kick simulator that runs in your browser.**<br>
Curl it, dip it, or knuckle it past the wall and the keeper. Every flight obeys real aerodynamics.

[![Play online](https://img.shields.io/badge/▶_Play-online-2ea44f?style=for-the-badge)](https://abahodirov.github.io/freekick-simulator/)

![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Physics tests](https://img.shields.io/badge/tests-107_passing-brightgreen)
[![Version](https://img.shields.io/badge/version-2.0.4-blueviolet)](https://github.com/abahodirov/freekick-simulator/releases/latest)
![Dependencies](https://img.shields.io/badge/dependencies-none-lightgrey)
![WebGL2](https://img.shields.io/badge/WebGL2-3D-orange)

<img src="docs/screenshot-v2.png" alt="Version 2: lining up a free kick from behind the ball, with a four-player wall and the keeper in a full stadium" width="860">

</div>

---

No install, no build step, no dependencies.

**Run it locally:** double-click `index.html` (any current Chrome, Edge, Firefox or Safari).

**Check the physics:** `node tests/physics.test.js` — 29 tests against conservation laws and closed-form results.
All nine suites (107 tests): `for t in tests/*.test.js; do node "$t"; done`

## What's new in v2.0.4

- **The Jabulani comes apart as it was built**: its 4 triangle panels (each coloured graphic with its white middle)
  and 4 white tripods, cut along the seams printed in its own texture.
- **A detailed Champions League ball** in the style of 2024-25: white panels and dark charcoal stars traced in green,
  each dark star one panel, grooves along every edge, domed panels, embossed outlines and red marks.
- **More room when a ball comes apart** (the Trionda's big panels no longer overlap; the starball's stars stand clear).
- **One ball on screen**: the corner logo is empty while the showcase is open, and the ball flying home becomes it.
- **Sharper photographs that always show the ball**, one per fact.
- **A softer sound** for turning the ball: airy and musical, no clicks.

## What's new in v2.0.3

- **Free kicks recreated from the footage.** Every exhibit was checked frame by frame against broadcast replays (main
  camera, behind-the-taker and behind-the-goal angles) for where the ball was placed and which corner it went into,
  and they now match: Roberto Carlos's ball sets off at the La Poste board right of the goal and bends back in off
  the inside of the right post just under the bar; Ronaldo's knuckles over the wall into the top right corner;
  Payet's dips late under the bar; Juninho's stays low to the far post.
- **Two new balls: the Fussballliebe (Euro 2024) and a Champions League starball**, in the showcase, the Ball lab and
  in play. Both have their grooves: the Fussballliebe's panel seams and raised rings come from its normal map, and the
  starball (a plain sphere with printed stars) gets a groove cut round every star panel.
- **Each ball flies its own way, from wind-tunnel data.** The Trionda has the earliest drag crisis and the most drag
  at speed (Scientific Reports, 2026): steady, but long kicks drop short. The Fussballliebe flies with the measurements
  of the Al Rihla, the closest published design: the steadiest, a no-spin strike hardly wobbles. The Jabulani keeps
  its wild knuckle; the Classic is the reference; no data exists for a Champions League ball, so it flies like the
  Classic.
- **The ball showcase is a map.** The ball sits in the middle with its facts around it on straight callout lines;
  click a fact for a real photograph (Wikimedia Commons, credited; sharp, always showing the ball, a different one for
  every fact: Messi and Mbappé with the Trionda at the 2026 World Cup, the final balls of the Champions League, the
  Jabulani and the Telstar). Hover or
  click the ball for **Anatomy**: it comes apart into its panels around its dark core (4 for the Trionda, 20 for the
  Fussballliebe, the Jabulani's 4 triangle and 4 tripod panels, 32 for the Classic; the starball, now in the 2024-25
  style with dark stars traced in green, comes apart into its white panels and dark stars), with only what each part is; the round U-turn arrow puts it together. Closing it, the ball spins and flies
  home into the logo. The facts are frosted-glass pills, and behind it all a living background in the ball's colours:
  React Bits' Aurora (Trionda, Fussballliebe, Jabulani, Classic) or Plasma (starball). Turning the ball by hand makes a
  soft rush of air instead of clicks.
- **Ronaldo's Portsmouth free kick is a knuckleball**: struck with almost no spin, it wobbles on the way and dips
  into the top right corner.
- **Payet's free kick re-struck**: 103 km/h with heavy curl and topspin, so it climbs over the wall, dips late and
  goes in off the underside of the bar, as at Upton Park.
- **Toni Kroos against Sweden (2018)** joins the free kicks: Kroos rolls the ball to Marco Reus, who stops it under
  his sole, and Kroos curls it into the far top corner. Kroos is a new taker; Koeman, Mihajlović and Nakamura are
  no longer takers.
- **A real goalkeeper's eyes.** In the keeper's view his gaze follows the ball smoothly, with a slight lag, follows it
  into the net after a goal, and then slowly turns to the scorer. His body moves with mass now: a split step as the
  ball is struck, weight shifts instead of a metronome bounce, and every joint eased through the dive.
- **The panels step aside for the kick**: 2.5 s before the strike the side rails and drawers slide off to their own
  sides, and glide back once the ball has settled.
- **A compact control bar** at the bottom: one row of icon buttons (hover any of them for its name and key), one Kick
  button, and a fold down to just Kick (B, or the chevron).
- **The section tabs bring the panels back**: with the panels hidden, clicking Play, Anatomy, Free kicks or Ball lab
  shows them again, so a tab always opens something.
- **No background crowd sound**; the Carlos recreation's wall is just "France wall".
- **Better celebrations**: no more frozen poses. The Siuuu turns to face the camera as he lands, the knee slide roars
  and pumps its fists, the penguin slide lies on the grass, and every gesture plays for a few seconds and then relaxes.
  A closer, broadcast-style celebration shot.
- **Taker camera removed** (the exhibition's second button is now "TV view").

## What's new in v2.0.2

- **Payet against Crystal Palace (2016)** joins the free-kick exhibition, with Dimitri Payet as a new taker in West
  Ham's claret and sky blue. The exhibition is trimmed to nine of the best-known free kicks.
- **TV camera** reframed like a real broadcast: high in the main stand, behind the ball, the goal top left and the
  taker bottom right.
- **Taker camera** (key `6`): the free kick through the taker's eyes, from the run-up to the ball hitting the net.
- **Clear button** in the bottom bar (or `X`) wipes the lines of earlier kicks.
- **Easier to find "Hide panels"**: the button now says what it does, lights up while the panels are hidden, and
  a one-time tip points to it.
- **A simpler Ball lab**: the three balls you can play with, three plain meters each, and one "Race all three"
  button. The wind-tunnel chart sits under "The science". The Cafusa is gone.

## What's new in v2.0.1

- **Keeper's-eye camera.** A fifth camera (key `5`) puts you behind the goalkeeper's eyes: it crouches, shuffles
  and dives with him and never loses the ball.
- **Celebrations switch.** Turn goal celebrations off under More → Match, or press `C` (remembered).
- **Balls you can feel.** The Trionda and Jabulani now show their real panel grooves, raised graphics and textured
  skin, baked from the models' normal maps. The classic ball is redrawn with deep seams, stitching, domed panels and
  pebbled leather.
- **A wilder Jabulani.** Hit it with almost no spin and it wobbles about twice as far as the other balls, and swerves
  late as it slows through its drag crisis.
- **Experiments removed** to keep the menu focused (Anatomy, Free kicks and Ball lab stay).

## What's new in v2

- **Real players.** Rigged, cel-shaded figures built from MakeHuman CC0 bodies, one per taker, keeper and wall
  player, dressed in each match's team colours.
- **Motion capture.** The taker's run-up and strike use recorded CMU motion capture, and the boot meets the ball at
  the exact moment the flight simulation starts.
- **Four new sections.** *Anatomy* (a narrated breakdown of one kick), *Free kicks* (12 famous goals recreated),
  *Experiments* (seven controlled physics experiments) and *Ball lab* (four balls with wind-tunnel drag data).
- **Match ball showcase.** The spinning ball in the top-left corner opens a 3-D viewer of World Cup balls, with
  facts about each and a button to play with it.
- **Strike from the boot.** An impact model turns boot speed and contact point into launch speed and spin.
- **A goalkeeper who really dives.** He is now a rigid body that pushes off, flies ballistically and lands, and
  can't change course mid-air.
- **Ten cameras** (up from six), pause-and-orbit mid-flight, and the replay now includes the strike.
- **Two looks.** Illustrated (ink outlines and flat tones) or a realistic stadium at day, sunset or night.
- **New layout.** Two slim icon rails open one focused drawer of controls at a time, with a small live readout.
- **103 tests** across nine suites (v1 had 29).

v1 is still available as the [`v1.0.0`](https://github.com/abahodirov/freekick-simulator/tree/v1.0.0) tag.

**Players** are stylized, cel-shaded rigged figures built from MakeHuman CC0 bodies, one per player: build, height and face traits approximate each footballer, with sculpted hair and beards grown from his own scalp and jaw, painted faces and clean outlines. Every free-kick recreation dresses the taker, wall and keeper in that day's team colours (see `assets/CREDITS.md`, rebuilt with `tools/build_players.py`).
Their skeleton is driven by the simulator's own physics and footwork (`js/people.js`) through retargeting
(`js/rig.js`), and kits, boots, skin tones and hair are painted on per player. If the model file is missing, the
simulator falls back to its built-in sculpted players.

## Controls

| Input | Action |
|---|---|
| `Space` | Kick / set up the next kick |
| Arrow keys | Aim direction and elevation (`Shift` = fine steps) |
| `W` `S` · `A` `D` · `Q` `E` | Ball speed · curl left/right · backspin/topspin |
| Drag on the pitch | Aim (or orbit, in the Orbit camera) |
| `1`–`5` | Cameras: behind the ball, TV, chase the ball, behind the goal, the keeper's eyes |
| `P` then drag | Pause mid-flight and orbit the ball |
| `R` `P` `M` `H` | Replay in slow motion, pause, mute, hide panels |
| `C` | Goal celebrations on / off |
| `X` | Clear the lines of earlier kicks |

Drag the ball on the position map to move the free kick. Click the goal-face chart and the simulator solves the aim
for that spot with your current speed and spin.

## Sections

- **Play** — the simulator.
- **Anatomy** — *The Anatomy of a Free Kick*: a narrated six-scene breakdown of one kick (setup, the player, the
  impact in slow motion with a freeze-frame, the flight with live force arrows, the goalkeeper, the conclusion).
  It has captions, optional voice narration, scene jumps and a timeline scrubber. Every number comes from the
  running simulation.
- **Free kicks** — an exhibition of 9 historic free kicks: Roberto Carlos 1997, Beckham 2001, Ronaldinho 2002,
  Ronaldo 2008, Juninho 2009, Pirlo 2013, Bale 2016, Payet 2016 and Messi 2019. Each case study gives the documented match facts with sources: date, venue, score, minute, distance,
  **the goalkeeper**, **the wall** (where a source records it) and **how the goal went in**. The 3-D recreation
  uses match-style kit colours and name tags over the taker, keeper and wall, and launch values labelled as
  estimates. When you watch a recreation, the goal goes in, as it did.
- **Strike from the boot** (Kick panel) — an impact model turns boot speed and the contact point into launch speed and
  spin (impulse with restitution; an off-centre hit trades speed for spin).
- **Ball lab** — the three balls you can play with (Classic, Jabulani, Trionda), each explained in plain words with
  three meters: how much a no-spin kick wobbles, its air resistance at shot speed, and the speed above which it turns
  "slippery". "Race all three" flies your current kick with each ball and draws the three paths on the pitch. "The
  science" holds the drag chart, with the Jabulani's drag crisis as measured in a wind tunnel by Hong & Asai (2014,
  *Scientific Reports* 4:5068).

- **Match ball** — click the spinning ball at the top left. The ball grows into a large 3-D view you can drag to
  turn, with tabs for other World Cup balls, a few facts about each, and a button to play with it.

Two looks: **Illustrated** (default: ink outlines, flat tones with hatching, a paper-white world, grey defenders)
and **Realistic stadium** (day / sunset / night).

## Features

- Six selectable free-kick takers (Ronaldo, Messi, Roberto Carlos, Beckham, Pirlo, Juninho), each with their own
  footedness, run-up and a signature technique preset. The taker runs up and strikes the ball with real recorded
  motion (CMU motion-capture jog and soccer kicks, rebuilt on each player's proportions), and the boot meets
  the ball at the exact instant the simulation starts. Looks and kits are generic: plain colours, no crests or likenesses.
- Articulated, shaped players: lofted torso, tapered limbs, faces, hair styles, boots, kit patterns and shirt numbers
- Ball speed, direction, elevation and spin (sliders, keyboard, or the strike-point pad), with five kick presets
- Live aim guide computed by the same physics engine; optional no-air path for comparison
- Defensive wall (0–6 players, optional jump) placed 9.15 m away covering the near post
- Goalkeeper as a diving rigid body: reaction time, a set position, a timed take-off, ballistic flight under gravity
  and a landing. He cannot change course in mid-air, and three skill levels set take-off speed and read quality
- Day, sunset and night lighting; clouds, stars, floodlights; an open end with a forest and hills beyond it
- Wind, air temperature, altitude, humidity, and three playing surfaces
- Telemetry: speed, height, spin, drag and Magnus force, drag coefficient, Reynolds number
- Flight-profile and goal-face charts, kick log (click a row to reload that set-up), CSV export of the trajectory
- Monte Carlo: repeat the kick 300 times with realistic kicker scatter to get a scoring probability
- Ten cameras, slow motion, replay (including the strike), synthesised sound

## Physics model

All SI units; the ball is a 0.43 kg, 0.11 m hollow sphere integrated with 4th-order Runge–Kutta at 1 kHz.

| Effect | Model |
|---|---|
| Gravity | 9.80665 m/s² |
| Drag | `F = ½ρ·Cd·A·v²` against the air-relative velocity. `Cd` follows the drag crisis (≈0.35 below the critical Reynolds number, ≈0.16 above), using the fit of Goff & Carré (2009), plus a small increase with spin |
| Magnus force | `F = ½ρ·Cl·A·v²` along `ω × v`, with `Cl = S/(2.32·S + 0.4)` and spin parameter `S = rω/v` |
| Spin decay | Aerodynamic torque proportional to `ρ·v·ω` (spin falls roughly 7% per second) |
| Knuckle effect | Below about 2 rev/s, a slowly varying side force (peak coefficient 0.13) |
| Air | Density from the ISA barometric formula with a humidity correction; viscosity from Sutherland's law |
| Bounce | Rigid-sphere impulse with restitution and Coulomb friction, coupling linear and angular momentum, so topspin kicks on and backspin checks |
| Rolling | Sliding friction until the ball rolls without slipping, then rolling resistance |
| Goal frame | Posts and crossbar are rigid cylinders; the net is a spring-damper membrane |
| Goal decision | Law 10: the whole ball must cross the line |
| Goalkeeper | Centre of mass + body angle + arms in the goal plane. Feet push off for 0.16–0.21 s up to a level-limited launch velocity (lateral 3.7–4.9 m/s, vertical ≤ 2.5–3.3 m/s), then pure projectile motion (gravity only) until the body meets the ground. Take-off is timed so a high ball is met near the top of the jump (flight time ≈ √(2Δz/g)). The ball is caught only if its speed relative to the gloves is below the level's limit, and a caught ball travels with the keeper |

**What is approximate.** The lift, spin-drag, spin-decay and knuckle coefficients are empirical fits chosen to sit inside
published wind-tunnel and trajectory ranges for footballs; they are not measurements of a specific ball. The knuckle
effect is a phenomenological model of an inherently chaotic flow. Wind is uniform with height. Wall players collide
as capsules. The keeper's take-off limits are plausible values for trained keepers, not measurements. The taker's
run-up and strike are animation: you still set launch speed and spin directly, and the signature presets are typical
values for each technique, not measurements of any particular goal.

## Files

- `index.html`, `css/style.css` — the page (open `index.html` directly; no server needed)
- `js/app.js` — controls, charts, game loop
- `js/ui.js` — the layout: icon rails, drawers and the live readout
- `js/physics.js` — the engine, including the goalkeeper body (also runs in Node)
- `js/people.js` — skeletons, poses, keeper dressing, the takers and their run-up animation (also runs in Node)
- `js/render.js` — WebGL2 renderer (stadium, surroundings, lighting presets, people, ball, net)
- `js/cameras.js` — camera rig
- `js/rig.js` — glTF parsing, retargeting our skeleton onto the rigged model, kit regions (also runs in Node)
- `assets/players.js` — the packed CC0 player bodies (generated by `tools/build_players.py`; see `assets/CREDITS.md`)
- `js/sculpt.js` — sculpted body parts (fallback players): head, hair, beard, hands, gloves, boots, and anatomical limb tubes (also runs in Node)
- `js/balls.js`, `js/history.js` — Ball lab and exhibition data, with sources (also run in Node)
- `js/labs.js`, `js/story.js` — Ball lab, Free kicks and the Anatomy story
- `js/ballview.js`, `js/showcase.js` — the standalone ball viewer, the spinning logo and the match-ball showcase
- `js/dock.js` — the control bar's fold (B)
- `js/backdrop.js` — the showcase's living backgrounds (React Bits' Aurora and Plasma, ported to WebGL2)
- `js/audio.js` — synthesised sound effects
- `assets/mocap.js` — CMU motion-capture clips for the run-up and strike (generated by `tools/mocap_build.js`)
- `assets/balls/` — 3-D ball models (generated by `tools/ball_model.js` and `tools/ball_bake.py`; `tools/ball_relief.py` cuts grooves into a model that has none; `tools/ball_panels.py` finds the panels for the exploded view)
- `tests/*.test.js` — physics, regression, force, keeper, people, camera, labs, sculpt and rig suites
- `tools/` — offline build scripts for the players, motion capture and balls (not needed to play)
- `docs/AUDIT.md` — the development audit and roadmap

## References

- Goff, J. E. & Carré, M. J. (2009). Trajectory analysis of a soccer ball. *American Journal of Physics* 77, 1020.
- Hong, S. & Asai, T. (2014). Effect of panel shape of soccer ball on its flight characteristics. *Scientific Reports* 4, 5068.
- Dupeux, G., Le Goff, A., Quéré, D. & Clanet, C. (2010). The spinning ball spiral. *New Journal of Physics* 12, 093004.
- Match facts for the exhibition: see the sources listed on each case study (`js/history.js`).

## Contributors

- [@abahodirov](https://github.com/abahodirov)
- [@TomasPerlovic](https://github.com/TomasPerlovic)

## Credits

Player bodies are from MakeHuman (CC0) and the motion is from the CMU Graphics Lab Motion Capture Database. Ball
models come from third parties under their own licences. Full details are in [`assets/CREDITS.md`](assets/CREDITS.md).

## License

[MIT](LICENSE). Free to use, modify and share, with no warranty.
