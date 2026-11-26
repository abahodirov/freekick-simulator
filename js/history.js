/*
 * The historical free-kick exhibition. Pure data, DOM-free (checked by tests/history.test.js).
 *
 * Rules followed here:
 *  - `facts` are documented details, each backed by the listed sources (press reports, governing-body pages).
 *  - Everything under `recon` is an ESTIMATE made for this simulator (ball spot, launch speed, spin, target),
 *    chosen to be consistent with the documented distance and the visible character of the shot. A reconstruction
 *    shows the physics of that kind of strike; it is not a measurement or an exact recreation of the goal.
 *  - Distances in sources are often given in yards and vary between outlets; the range is stated, not hidden.
 *  - No footage or images are included; the links point to the reporting.
 *
 * Coordinates: metres; ball.x = distance up the pitch from the goal line, ball.y = + to the kicker's right.
 * kick: speed m/s, side spin rev/s (+ curls to the kicker's right), top spin rev/s (+ topspin, − backspin).
 * target: where the aim is solved to cross the goal line (y, z), before knuckle effects.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FKHistory = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // kits: the team each player was playing for on the day, in that team's colours (shades approximate; Portugal 2018
  // and Barcelona 1992 checked against kit archives, the others are the clubs' and countries' usual home strips).
  // attack: null = the taker's default look. defence = the wall; keeper = the goalkeeper.
  const KICKS = [
    {
      id: 'carlos-1997', taker: 'carlos', title: 'The banana from 35 metres',
      wallNames: ['France wall (incl. Zidane)'],   // documented collectively, not who stood where
      facts: {
        player: 'Roberto Carlos', for: 'Brazil', opponent: 'France', competition: 'Tournoi de France (friendly tournament)',
        date: '1997-06-03', venue: 'Stade de Gerland, Lyon', result: '1–1', minute: '21',
        distance: 'Usually given as about 35 m; reported figures range from roughly 33 to 36 m (some outlets say 35–40 yards).',
        goalkeeper: 'Fabien Barthez',
        wall: 'Four French players, Zinedine Zidane among them (ESPN). Roberto Carlos took about 18 steps back for his run-up.',
        how: 'Struck with the outside of the left foot, it swerved around the wall and went in off the post.',
      },
      kits: { attack: { shirt: [0.98, 0.84, 0.10], shirt2: [0.98, 0.84, 0.10], pattern: 0, trim: [0.05, 0.5, 0.25], shorts: [0.10, 0.30, 0.65], socks: [0.96, 0.96, 0.96], number: 6 }, defence: { shirt: [0.12, 0.2, 0.55], trim: [0.96, 0.96, 0.96], shorts: [0.95, 0.95, 0.95], socks: [0.78, 0.12, 0.16] }, keeper: { shirt: [0.25, 0.27, 0.3], shorts: [0.15, 0.15, 0.17], socks: [0.25, 0.27, 0.3] } },
      moment: 'An opening match of a pre-World Cup tournament. A long, straight run-up from well behind the ball.',
      technique: 'Struck very hard with the outside of the left foot, so the ball spun strongly about a near-vertical axis.',
      physics: 'The Magnus force pushes the ball sideways while drag slows it. As the speed falls, the spin parameter S = rω/v rises, so the sideways bend gets tighter late in the flight. Physicists have described the path as closer to a spiral than an arc.',
      keeper: 'The ball starts on a line that looks wide of the goal, so the keeper has no early cue to move.',
      takeaway: 'Spin matters more as a ball slows down: the same spin bends a slow ball more than a fast one.',
      experiment: { param: 'side', label: 'Side spin (rev/s)', values: [-4, -7, -10, -12] },
      sources: [
        { title: 'ESPN: the physics of the "impossible" strike', url: 'https://www.espn.com/soccer/story/_/id/37475858/physics-impossible-strike' },
        { title: 'Sports Illustrated: revisiting the free kick 22 years on', url: 'https://www.si.com/soccer/2019/06/03/roberto-carlos-revisiting-free-kick-against-france-legacy-it-holds-22-years' },
        { title: 'Dupeux, Le Goff, Quéré & Clanet (2010), The spinning ball spiral, New Journal of Physics 12, 093004', url: 'https://doi.org/10.1088/1367-2630/12/9/093004' },
      ],
      recon: { ball: { x: 34.5, y: 4 }, kick: { speed: 36, side: -11, top: 0.5 }, target: { y: 3.1, z: 0.9 }, wall: 4, keeper: 'pro' },
    },
    {
      id: 'beckham-2001', taker: 'beckham', title: 'The equaliser in stoppage time',
      facts: {
        player: 'David Beckham', for: 'England', opponent: 'Greece', competition: '2002 World Cup qualifier',
        date: '2001-10-06', venue: 'Old Trafford, Manchester', result: '2–2', minute: '90+3',
        distance: 'Reported as about 30 yards (≈ 27 m).',
        goalkeeper: 'Antonios Nikopolidis',
        wall: 'A four-man Greek wall (individual players not recorded in the sources found).',
        how: 'Curled over the wall and beyond the keeper\'s reach into the top corner.',
      },
      kits: { attack: { shirt: [0.96, 0.96, 0.96], shirt2: [0.96, 0.96, 0.96], pattern: 0, trim: [0.08, 0.12, 0.32], shorts: [0.08, 0.12, 0.32], socks: [0.96, 0.96, 0.96], number: 7 }, defence: { shirt: [0.1, 0.3, 0.7], trim: [0.96, 0.96, 0.96], shorts: [0.1, 0.3, 0.7], socks: [0.1, 0.3, 0.7] }, keeper: { shirt: [0.2, 0.2, 0.22], shorts: [0.2, 0.2, 0.22], socks: [0.2, 0.2, 0.22] } },
      moment: 'England were 2–1 down in stoppage time and a draw would send them straight to the World Cup.',
      technique: 'Right foot, inside of the boot, wide approach: a classic curler struck up over the wall.',
      physics: 'Side spin about a tilted axis gives a Magnus force with a sideways part (the curl) and a downward part. Together they lift the ball over the wall and then bring it down under the bar.',
      keeper: 'The ball comes over the wall: the keeper loses sight of it at the strike and picks it up late.',
      takeaway: 'Curl lets a ball go around and over a wall that a straight shot could never beat.',
      experiment: { param: 'side', label: 'Side spin (rev/s)', values: [-4, -7, -9, -11] },
      sources: [
        { title: 'FourFourTwo: on this day in 2001', url: 'https://www.fourfourtwo.com/us/news/on-this-day-in-2001-david-beckham-takes-england-to-the-world-cup-1633431649000' },
        { title: '90min: anatomy of a goal', url: 'https://www.90min.com/posts/anatomy-of-a-goal-david-beckham-last-minute-free-kick-greece' },
      ],
      recon: { ball: { x: 26.5, y: 3 }, kick: { speed: 26.5, side: -9, top: 2 }, target: { y: -3.0, z: 2.05 }, wall: 4, keeper: 'pro' },
    },
    {
      id: 'ronaldo-2008', taker: 'ronaldo', title: 'The knuckleball against Portsmouth',
      facts: {
        player: 'Cristiano Ronaldo', for: 'Manchester United', opponent: 'Portsmouth', competition: 'Premier League',
        date: '2008-01-30', venue: 'Old Trafford, Manchester', result: '2–0', minute: null,
        distance: 'Reported as about 30 yards (≈ 27 m).',
        goalkeeper: 'David James',
        wall: 'Not recorded in the sources found.',
        how: 'A knuckling strike that moved in the air and flew into the top corner while the keeper stayed rooted.',
      },
      kits: { attack: { shirt: [0.75, 0.08, 0.1], shirt2: [0.75, 0.08, 0.1], pattern: 0, trim: [0.96, 0.96, 0.96], shorts: [0.95, 0.95, 0.95], socks: [0.08, 0.08, 0.09], number: 7 },
        defence: { shirt: [0.1, 0.22, 0.6], shorts: [0.95, 0.95, 0.95], socks: [0.75, 0.1, 0.12] }, keeper: { shirt: [0.9, 0.75, 0.1], shorts: [0.1, 0.1, 0.12], socks: [0.9, 0.75, 0.1] } },
      moment: 'A mid-season league match; Alex Ferguson called it the best free kick he had seen in the Premier League.',
      technique: 'Struck through the centre of the ball with the instep and little follow-through, giving very little spin.',
      physics: 'With almost no spin there is no steady Magnus force. Instead, the airflow separates unevenly and the uneven wake pushes the ball sideways in small, changing amounts. The simulator models this as a slowly varying side force, a phenomenological model rather than a measured one.',
      keeper: 'Reports describe the keeper as rooted to the spot: a late, unpredictable movement gives nothing to read.',
      takeaway: 'Less spin can make a ball harder to predict, not easier.',
      experiment: { param: 'top', label: 'Total spin (rev/s, top)', values: [0, 0.5, 1.5, 3] },
      sources: [
        { title: 'NBC Sports: Ronaldo free kick (top 30 Premier League moments)', url: 'https://nbcsports.com/soccer/news/cristiano-ronaldo-free-kicktop-30-premier-league-moments-no-20' },
        { title: 'Planet Football: the Pompey free kick', url: 'https://www.planetfootball.com/nostalgia/cristiano-ronaldo-pompey-free-kick-decade-trying-top-perfection' },
      ],
      recon: { ball: { x: 27, y: -2 }, kick: { speed: 31, side: 0, top: 0.2 }, target: { y: 2.6, z: 1.9 }, wall: 4, keeper: 'pro', keeperRooted: true },
    },
    {
      id: 'juninho-2009', taker: 'juninho', title: 'Gerland against Barcelona',
      facts: {
        player: 'Juninho Pernambucano', for: 'Olympique Lyonnais', opponent: 'FC Barcelona', competition: 'UEFA Champions League, round of 16, 1st leg',
        date: '2009-02-24', venue: 'Stade de Gerland, Lyon', result: '1–1', minute: '7',
        distance: 'Not consistently reported; the reconstruction uses an estimate.',
        goalkeeper: 'Víctor Valdés',
        wall: 'Not recorded in the sources found.',
        how: 'Over the keeper and inside the top far corner.',
      },
      kits: { attack: { shirt: [0.96, 0.96, 0.96], shirt2: [0.96, 0.96, 0.96], pattern: 0, trim: [0.12, 0.22, 0.6], shorts: [0.96, 0.96, 0.96], socks: [0.96, 0.96, 0.96], number: 8 }, defence: { shirt: [0.1, 0.2, 0.55], shirt2: [0.62, 0.08, 0.2], pattern: 1, shorts: [0.1, 0.2, 0.55], socks: [0.1, 0.2, 0.55] }, keeper: { shirt: [0.15, 0.6, 0.3], shorts: [0.15, 0.15, 0.17], socks: [0.15, 0.6, 0.3] } },
      moment: 'Early in a knockout tie; the ball went over the keeper into the top far corner.',
      technique: 'Juninho\'s trademark knuckle strike: hit with a short, stabbing contact and almost no follow-through.',
      physics: 'Low spin and a high speed put the ball in the region where the wake is unsteady, so the side force keeps changing during the flight.',
      keeper: 'A ball whose sideways drift changes late is hard to time a dive against.',
      takeaway: 'Above the drag crisis, a low-spin ball keeps its speed and can still wander.',
      experiment: { param: 'speed', label: 'Launch speed (m/s)', values: [24, 28, 32, 35] },
      sources: [
        { title: 'UEFA: Barça glad to escape Lyon\'s den unscathed', url: 'https://www.uefa.com/uefachampionsleague/news/01d6-0e70ecb832e9-37f295929157-1000--barca-glad-to-escape-lyon-s-den-unscathed' },
        { title: 'Planet Football: an ode to Juninho', url: 'https://www.planetfootball.com/nostalgia/juninho-pernambucano-footballs-god-of-chaos' },
      ],
      recon: { ball: { x: 30, y: -2 }, kick: { speed: 31, side: 0, top: 0.15 }, target: { y: 3.0, z: 2.15 }, wall: 4, keeper: 'pro' },
    },
    {
      id: 'messi-2019', taker: 'messi', title: 'The 600th goal',
      facts: {
        player: 'Lionel Messi', for: 'FC Barcelona', opponent: 'Liverpool', competition: 'UEFA Champions League, semi-final, 1st leg',
        date: '2019-05-01', venue: 'Camp Nou, Barcelona', result: '3–0', minute: '82',
        distance: 'Reported as about 30 yards (≈ 27 m); one outlet says more than 30 yards.',
        goalkeeper: 'Alisson Becker',
        wall: 'Not recorded in the sources found.',
        how: 'Curled over the wall into the top corner past the keeper.',
      },
      kits: { attack: { shirt: [0.1, 0.2, 0.55], shirt2: [0.62, 0.08, 0.2], pattern: 1, trim: [0.95, 0.78, 0.2], shorts: [0.1, 0.2, 0.55], socks: [0.1, 0.2, 0.55], number: 10 },
        defence: { shirt: [0.78, 0.07, 0.1], shorts: [0.78, 0.07, 0.1], socks: [0.78, 0.07, 0.1] }, keeper: { shirt: [0.2, 0.2, 0.22], shorts: [0.2, 0.2, 0.22], socks: [0.2, 0.2, 0.22] } },
      moment: 'His second goal of the night and his 600th for Barcelona; later voted the Champions League goal of the season.',
      technique: 'Left foot, inside of the boot: lifted high over the wall and curled into the top corner.',
      physics: 'A combination of side spin and topspin: the spin axis is tilted, so the Magnus force both curls the ball and pulls it down into the corner.',
      keeper: 'A high, curling ball reaches the corner at the edge of the keeper\'s reach, and his take-off must be timed for the top of the jump.',
      takeaway: 'Tilting the spin axis mixes curl and dip, so one strike can do both.',
      experiment: { param: 'side', label: 'Side spin (rev/s)', values: [4, 6, 8.5, 11] },
      sources: [
        { title: 'UEFA: Messi scores 600th Barcelona goal', url: 'https://www.uefa.com/uefachampionsleague/news/0251-0e976d49a0da-964e0f545a63-1000--messi-scores-600th-barcelona-goal' },
        { title: 'Sports Illustrated: voted goal of the tournament', url: 'https://www.si.com/soccer/2019/06/04/lionel-messis-free-kick-against-liverpool-voted-champions-league-goal-tournament' },
      ],
      recon: { ball: { x: 27, y: -1 }, kick: { speed: 26.5, side: 8.5, top: 2.5 }, target: { y: 3.25, z: 2.15 }, wall: 4, keeper: 'pro' },
    },
    {
      id: 'ronaldinho-2002', taker: 'ronaldinho', title: 'Over Seaman from the touchline',
      facts: {
        player: 'Ronaldinho', for: 'Brazil', opponent: 'England', competition: '2002 FIFA World Cup, quarter-final',
        date: '2002-06-21', venue: 'Shizuoka, Japan', result: '2–1', minute: null,
        distance: 'Most often reported as about 35 yards (≈ 32 m), wide on the right; estimates range from 30 to 50 yards.',
        goalkeeper: 'David Seaman',
        wall: 'Not recorded in the sources found.',
        how: 'From wide on the right, the ball looped over the keeper, who was off his line, and dropped into the far top corner. Whether it was a shot or a cross is still debated.',
      },
      kits: { attack: { shirt: [0.98, 0.84, 0.10], shirt2: [0.98, 0.84, 0.10], pattern: 0, trim: [0.05, 0.5, 0.25], shorts: [0.10, 0.30, 0.65], socks: [0.96, 0.96, 0.96], number: 11 }, defence: { shirt: [0.95, 0.95, 0.95], trim: [0.1, 0.12, 0.3], shorts: [0.1, 0.12, 0.3], socks: [0.95, 0.95, 0.95] }, keeper: { shirt: [0.9, 0.7, 0.1], shorts: [0.15, 0.15, 0.17], socks: [0.9, 0.7, 0.1] } },
      moment: 'A World Cup quarter-final level at 1–1; the free kick won it for Brazil.',
      technique: 'A high, floated ball with modest speed — closer to a chip than a drive.',
      physics: 'A slow, high ball spends a long time in the air, so gravity shapes the flight more than the aerodynamic forces do. It also drops steeply at the end, so a keeper standing off his line has to retreat and jump at the same time.',
      keeper: 'Positioning, not reaction, was the problem: from a step off the line the dropping ball is very hard to reach.',
      takeaway: 'A slow, high ball can beat a keeper just as well as a fast one, if it drops behind him.',
      experiment: { param: 'speed', label: 'Launch speed (m/s)', values: [19, 21, 23, 25] },
      sources: [
        { title: 'FIFA: wonder goal or fluke? Ronaldinho\'s 2002 strike remembered', url: 'https://inside.fifa.com/en/news/wonder-goal-or-fluke-ronaldinho-s-2002-strike-remembered-2887509' },
        { title: 'Sports Illustrated: on this day, 21 June', url: 'https://www.si.com/soccer/2018/06/21/day-21st-june-ronaldinho-wonder-free-kick-dumps-england-out-2002-world-cup' },
      ],
      // the keeper starts 2 m off his line toward the near post (estimate of the documented "off his line" position)
      recon: { ball: { x: 27, y: 17 }, kick: { speed: 24, side: -1.5, top: 1.5 }, target: { y: -3.0, z: 2.1 }, wall: 3, keeper: 'pro', keeperPos: { x: 2.0, y: 0.8 } },
    },
    {
      id: 'pirlo-2013', taker: 'pirlo', title: 'The 100th cap at the Maracanã',
      facts: {
        player: 'Andrea Pirlo', for: 'Italy', opponent: 'Mexico', competition: '2013 FIFA Confederations Cup, group stage',
        date: '2013-06-16', venue: 'Maracanã, Rio de Janeiro', result: '2–1', minute: '27',
        distance: 'Reported as about 25 yards (≈ 23 m); some reports say 25–30 m.',
        goalkeeper: 'José de Jesús Corona',
        wall: 'Not recorded in the sources found. The free kick came from a foul on Mario Balotelli.',
        how: 'Right foot, curled over the wall into the top left corner on his 100th appearance for Italy.',
      },
      kits: { attack: { shirt: [0.10, 0.34, 0.75], shirt2: [0.10, 0.34, 0.75], pattern: 0, trim: [0.85, 0.72, 0.35], shorts: [0.96, 0.96, 0.96], socks: [0.10, 0.34, 0.75], number: 21 }, defence: { shirt: [0.1, 0.42, 0.25], trim: [0.96, 0.96, 0.96], shorts: [0.95, 0.95, 0.95], socks: [0.75, 0.1, 0.12] }, keeper: { shirt: [0.95, 0.6, 0.12], shorts: [0.95, 0.6, 0.12], socks: [0.95, 0.6, 0.12] } },
      moment: 'Pirlo\'s 100th cap, in the first competitive match at the renovated Maracanã.',
      technique: 'Toes under the ball, struck with spin over the wall: the ball rises, then dips into the corner.',
      physics: 'Topspin tilts the Magnus force downward, so the ball falls faster than gravity alone would make it. That is the "dip" a keeper misjudges.',
      keeper: 'A ball that dips late looks to the keeper as if it is going over the bar until the final metres.',
      takeaway: 'Topspin turns a shot that would go over into one that drops under the bar.',
      experiment: { param: 'top', label: 'Topspin (rev/s)', values: [0, 2.5, 5, 7] },
      sources: [
        { title: 'UEFA: centurion Pirlo helps Italy overcome Mexico', url: 'https://uefa.com/european-qualifiers/news/020a-0e1413b04f7b-c97d98873fd3-1000--centurion-pirlo-helps-italy-overcome-mexico' },
        { title: 'Al Jazeera: Pirlo and Balotelli power Italy to win', url: 'https://www.aljazeera.com/sports/2013/6/16/pirlo-and-balotelli-power-italy-to-win' },
      ],
      recon: { ball: { x: 23, y: 2 }, kick: { speed: 26, side: -3, top: 5 }, target: { y: -3.0, z: 2.0 }, wall: 4, keeper: 'pro' },
    },
    {
      id: 'bale-2016', taker: 'bale', title: 'The long-range knuckleball at Lens',
      facts: {
        player: 'Gareth Bale', for: 'Wales', opponent: 'England', competition: 'UEFA EURO 2016, group stage',
        date: '2016-06-16', venue: 'Lens, France', result: '1–2', minute: null,
        distance: 'Reported as about 35 yards (≈ 32 m).',
        goalkeeper: 'Joe Hart',
        wall: 'Not recorded in the sources found.',
        how: 'A knuckling, 35-yard free kick that beat the keeper. It was one of Bale\'s two direct free-kick goals at that EURO, a feat UEFA says only Platini (1984) and Hässler (1992) had managed before.',
      },
      kits: { attack: { shirt: [0.78, 0.08, 0.12], shirt2: [0.78, 0.08, 0.12], pattern: 0, trim: [0.96, 0.96, 0.96], shorts: [0.78, 0.08, 0.12], socks: [0.78, 0.08, 0.12], number: 11 },
        defence: { shirt: [0.96, 0.96, 0.96], shorts: [0.1, 0.12, 0.3], socks: [0.96, 0.96, 0.96] }, keeper: { shirt: [0.12, 0.6, 0.3], shorts: [0.12, 0.6, 0.3], socks: [0.12, 0.6, 0.3] } },
      moment: 'Wales led England at half-time thanks to this free kick, though England won 2–1.',
      technique: 'A straight-on strike through the middle of the ball, with a short follow-through to keep the spin low.',
      physics: 'From 30+ metres a low-spin ball spends over a second in the unsteady-wake regime, so the side force keeps changing. The longer the flight, the bigger the wobble.',
      keeper: 'A wobbling ball from long range gives the keeper time to move but nothing reliable to move toward.',
      takeaway: 'Knuckleballs get more unpredictable the further they travel.',
      experiment: { param: 'top', label: 'Total spin (rev/s, top)', values: [0, 0.5, 1.5, 3] },
      sources: [
        { title: 'UEFA: EURO finals free-kicks, the full list', url: 'https://www.uefa.com/uefaeuro/history/news/0253-0d818a021f7c-a4444f676b3e-1000--euro-finals-free-kicks-the-full-list' },
        { title: 'Sports Illustrated: Bale free kick v England', url: 'https://www.si.com/soccer/2016/06/16/gareth-bale-wales-england-free-kick-goal-video-joe-hart' },
      ],
      recon: { ball: { x: 31.5, y: 4 }, kick: { speed: 32, side: 0, top: 0.3 }, target: { y: 2.4, z: 1.9 }, wall: 4, keeper: 'pro' },
    },
    {
      id: 'payet-2016', taker: 'payet', title: 'Over the wall at Upton Park',
      facts: {
        player: 'Dimitri Payet', for: 'West Ham United', opponent: 'Crystal Palace', competition: 'Premier League',
        date: '2016-04-02', venue: 'Boleyn Ground (Upton Park), London', result: '2–2', minute: 41,
        distance: 'Reported as about 25 yards (≈ 23 m), awarded for a foul by Joel Ward.',
        goalkeeper: 'Wayne Hennessey',
        wall: 'A full Crystal Palace wall, with West Ham players standing in front of it.',
        how: 'Curled up over the wall and dipped late into the top far corner, coming down off the underside of the crossbar while Hennessey stayed rooted to the spot.',
      },
      kits: { attack: { shirt: [0.48, 0.10, 0.20], shirt2: [0.48, 0.10, 0.20], sleeves: [0.47, 0.74, 0.92], pattern: 0, trim: [0.47, 0.74, 0.92], shorts: [0.96, 0.96, 0.96], socks: [0.48, 0.10, 0.20], number: 27 },
        defence: { shirt: [0.96, 0.96, 0.96], shorts: [0.96, 0.96, 0.96], socks: [0.96, 0.96, 0.96] }, keeper: { shirt: [0.95, 0.85, 0.15], shorts: [0.95, 0.85, 0.15], socks: [0.95, 0.85, 0.15] } },
      moment: 'It put West Ham 2–1 up just before half-time. Palace came back to draw 2–2 after Cheikhou Kouyaté was sent off.',
      technique: 'A short, angled run and a whip of the right instep: the ball is struck slightly off-centre and low, so it climbs steeply with heavy curl and some topspin.',
      physics: 'Side spin bends the ball around the end of the wall while topspin drags it down in the last few metres. It spends the first half of the flight rising, so the keeper has to read it late.',
      keeper: 'From behind the wall the keeper sees the ball only as it clears the heads, already curling away from him: by then it is dropping into the corner.',
      takeaway: 'Height over the wall and late dip from topspin together beat a set, well-placed keeper.',
      experiment: { param: 'top', label: 'Topspin (rev/s)', values: [0, 1.5, 3, 4.5] },
      sources: [
        { title: 'West Ham United: West Ham United 2-2 Crystal Palace', url: 'https://whufc.com/news/articles/2016/april/02-april/west-ham-united-2-2-crystal-palace' },
        { title: 'West Ham United: All Angles, Payet\'s Crystal Palace free-kick', url: 'https://whufc.com/news/articles/2020/april/02-april/all-angles-dimitri-payets-sensational-crystal-palace-free-kick' },
        { title: 'Sky Sports: West Ham 2-2 Crystal Palace, ten-man Hammers held at home', url: 'https://www.skysports.com/football/news/11661/10227209/west-ham-2-2-crystal-palace-ten-man-hammers-held-at-home' },
      ],
      recon: { ball: { x: 22, y: 6.5 }, kick: { speed: 26, side: -8, top: 3 }, target: { y: -3.0, z: 2.15 }, wall: 5, keeper: 'pro' },
    },
  ];
  return { KICKS };
});
