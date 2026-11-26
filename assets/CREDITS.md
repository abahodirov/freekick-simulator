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
- **Classic ball** ("Soccer ball / Football", by RPSebb on Sketchfab): its texture is plain black and white, so the
  classic ball is now drawn procedurally (js/render.js, js/ballview.js) with seam grooves, stitching, domed panels and
  a pebbled skin; the model file is no longer shipped. Rebuild it any time with `tools/ball_model.js`.
The ball designs themselves belong to adidas.