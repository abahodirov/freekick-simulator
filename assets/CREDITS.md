# Asset credits

## Player bodies and faces — `assets/players.js`

**MakeHuman** (makehumancommunity.org): the base mesh `hm08`, the body and face shape targets, the game-engine
skeleton and its skin weights, and the skin region masks (lips, eyelids, ears, nails). Data taken from
https://github.com/makehumancommunity/mpfb2 (`src/mpfb/data`).

License: **CC0 1.0 Universal** (public domain). The base mesh header says it "was explicitly released as CC0 in
september 2020", and the weights file declares CC0.

How it is used: `tools/build_players.py` blends MakeHuman targets per player (muscle, weight, height, proportions,
ethnicity, and face traits such as jaw, chin, nose, cheekbones and lips). The results are approximations chosen from
public photos, not scans or likenesses. The script also does the following:
- sculpts the kit into the body (fabric over the torso and thighs, round collar, boots without toes);
- scales the heads up 7 % for the stylized proportions;
- grows all hair and beards as solid sculpted shells from each player's own scalp and jaw;
- paints flat stylized skin, eye, eyebrow and hairline textures procedurally in the MakeHuman UV layout.

Everything is packed into one script file, so the simulator still works when `index.html` is opened from disk.

## Earlier player assets (no longer packed)

- **MakeHuman system assets** (CC0 1.0, asset pack `makehuman_system_assets_cc0.zip`): photo skins, hair meshes,
  eyebrows, eyelashes and eyes were used in stage 15. The stylized build does not include them; `tools/build_players.py`
  still fits them when the `MH_SYS` environment variable points at the unpacked pack.
- "Universal Base Characters" by **Quaternius** (CC0 1.0), https://quaternius.com. The current build includes no
  Quaternius data (the build script still reads its head mesh only as a size reference).

## Motion

The motion comes from the simulator's own physics and locomotion (`js/people.js`), retargeted onto the rig
(`js/rig.js`). Kits, boots and skin tones are painted at run time by `js/render.js`.

## Motion capture

**CMU Graphics Lab Motion Capture Database** (mocap.cs.cmu.edu). "The data used in this project was obtained from
mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." The data is free to use, including
in products; it may not be resold as data.

- Subject 10, trials 10_01, 10_02, 10_03, 10_05, 10_06 (soccer: kick ball). 10_03, 10_05 and 10_06 drive the strike;
  the standing before 10_02 is the idle used by the taker and the wall.
- Subject 16, trial 16_35 (run/jog): the run-up cycle. Subject 35 trials 35_17 and 35_22 were downloaded for
  comparison and are not used.

How it is used: `tools/mocap_parse.js` reads the ASF skeletons and AMC motions into joint positions (metres, z up,
60 fps); `tools/mocap_build.js` cuts the jog cycle (loop closed by a cross-fade into the stride before), the standing
idle and the kicks into canonical frames and writes `assets/mocap.js`. At run time `js/people.js` places them in the
world, mirrors them for left-footers, blends where they meet and rebuilds the body on each player's proportions.

## Ball models

The match balls are 3-D models purchased by the project owner, converted with `tools/ball_model.js` (glTF/OBJ/binary
FBX → `assets/balls/<id>.js`, textures downsized to 2048 px JPEG) and baked onto a sphere map for the in-game ball with
`tools/ball_bake.py`, which also bakes each model's normal map (grooves and surface relief) into a sphere normal map:
- **Jabulani**: FBX + 3K colour and normal textures (`Jabula_3k.png`, `Jabula_3k_Normal.png`).
- **Trionda**: "Trionda 2026.glb", with its embedded colour and normal maps.
- **Fussballliebe (Euro 2024)**: "Soccer Ball Fussballliebe Euro 2024" by jonathanborges3d (Sketchfab), glTF with
  colour and normal maps; its triangle strips are read by `tools/ball_model.js`.
- **Champions League ball** (by Sintakinar Blogspot): OBJ + colour texture. It is a plain UV sphere with no relief, so
  `tools/ball_relief.py` cuts a groove along every white star panel and writes the matching normal map. Two marks
  printed inside its panels that do not belong on a Champions League ball (a Europa League and a World Cup 2022 logo)
  were painted out.
- **Classic ball** ("Soccer ball / Football", by RPSebb on Sketchfab): its texture is plain black and white, so the
  classic ball is now drawn procedurally (js/render.js, js/ballview.js) with seam grooves, stitching, domed panels and
  a pebbled skin; the model file is no longer shipped. Rebuild it any time with `tools/ball_model.js`.
The ball designs themselves belong to adidas.

Panel maps for the showcase's exploded view (`tools/ball_panels.py`): the Trionda's 4 and the Fussballliebe's 20
panels are the texture islands of their models; the starball's stars come from its grooves; the Jabulani's 8 (4 triangle
panels, each a coloured graphic with its white middle, and 4 tripods, as in adidas's cutaway) follow the seams printed
as thin grey lines in its colour map (`tools/ball_panels_jabulani.py`); the starball's printed ground is split under its
stars (`tools/ball_panels_ucl_ground.py`) and recoloured in the style of the 2024-25 ball, dark charcoal stars traced in
green, one panel per dark star, with its grooves and print (`tools/ball_ucl_recolour.py`, `tools/ball_ucl_detail.py`); the Classic's 32 are its geometry.

## Showcase photographs

Loaded from Wikimedia Commons at run time (not shipped), at 1600 px, each showing the ball, one per fact and none
twice, credited under each picture. Where no free photograph of a ball could be found, the fact shows text only.
- Trionda: at the World Cup draw reception, UK in USA, CC BY-SA 4.0; on the pitch at France v Senegal, Lionel Messi
  (Argentina v Egypt) and Jonathan David (Canada v Qatar) at the 2026 World Cup, Bryan Berlin, CC BY-SA 4.0.
- Fussballliebe: a replica, Bildersindtoll, CC0 (the only free photograph of the ball found).
- Champions League (the 2024-25 ball): Salzburg v Paris Saint-Germain (10 December 2024) and Salzburg v Atlético
  Madrid (29 January 2025), Werner100359, CC BY-SA 4.0.
- Jabulani: on the shelf and with Germany's kit, BrokenSphere, CC BY-SA 3.0; Brazil training in Soweto, Marcello
  Casal Jr / Agência Brasil, CC BY 3.0 BR; the Jo'bulani, warrenski, CC BY-SA 2.0.
- Classic: the 1970 Telstar, Zac Allan, public domain; giant Telstars in Berlin, Times, CC BY-SA 3.0; the 1974 Telstar
  Durlast, Haeferl, CC BY-SA 3.0.

`assets/showcase/ucl-zidane-2002.webp`, `ucl-messi-2009.webp` and `ucl-bale-2018.webp` (the 2002, 2009 and 2018
Champions League finals) were supplied by the project owner; they appear to be press-agency photographs.
`euro-bellingham.webp`, `euro-yamal-2024.webp` and `euro-musiala.webp` were supplied by the project owner too
(credited in the owner's own document).

`assets/showcase/trionda-sensor.webp` (the Trionda's sensor module out of its panel) was supplied by the project owner;
it appears to be an adidas product photograph.

## Showcase backgrounds

"Aurora" and "Plasma" from React Bits (reactbits.dev/backgrounds), ported from their React components to plain
WebGL2 in `js/backdrop.js` with the shaders unchanged; see React Bits for their licence.

## Ball aerodynamics

- Hong & Asai (2014), Effect of panel shape of soccer ball on its flight characteristics, Scientific Reports 4:5068.
- Comparative study of the aerodynamic characteristics and flight behavior of the FIFA World Cup 2026 ball Trionda,
  Scientific Reports (2026): critical Reynolds numbers of Trionda, Al Rihla, Telstar 18 and Brazuca, Trionda's
  supercritical drag, and the ranking of their unsteady side and lift forces.
- Goff, Hong, Liu & Asai (2026), Trionda: Enhanced Surface Roughness Relative to Previous FIFA World Cup Match Balls,
  Applied Sciences 16:2808 (seam length, width and depth), and J. E. Goff's summary in The Conversation (May 2026).