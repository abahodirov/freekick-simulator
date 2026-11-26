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
      id: 'ronaldo-2018', taker: 'ronaldo', title: 'The hat-trick against Spain',
      facts: {
        player: 'Cristiano Ronaldo', for: 'Portugal', opponent: 'Spain', competition: '2018 FIFA World Cup, group stage',
        date: '2018-06-15', venue: 'Fisht Stadium, Sochi', result: '3–3', minute: '88',
        distance: 'Reported as about 20 yards (≈ 18 m).',
        goalkeeper: 'David de Gea',
        wall: 'Not recorded in the sources found.',
        how: 'Over the wall and into the top corner; reports say the keeper never moved.',
      },
      kits: { attack: { shirt: [0.7, 0.07, 0.12], shirt2: [0.7, 0.07, 0.12], pattern: 0, trim: [0.05, 0.42, 0.22], shorts: [0.7, 0.07, 0.12], socks: [0.05, 0.42, 0.22], number: 7 }, defence: { shirt: [0.88, 0.91, 0.95], trim: [0.55, 0.7, 0.85], shorts: [0.88, 0.91, 0.95], socks: [0.88, 0.91, 0.95] }, keeper: { shirt: [0.85, 0.85, 0.2], shorts: [0.85, 0.85, 0.2], socks: [0.85, 0.85, 0.2] } },
      moment: 'Portugal were 3–2 down; the goal completed a hat-trick. It was reported as his first direct free-kick goal at a major tournament for Portugal.',
      technique: 'Up and over the wall from close range and into the top corner.',
      physics: 'From short range the ball must climb steeply and fall quickly. Topspin helps: its Magnus force points down, so the ball drops faster after clearing the wall.',
      keeper: 'Reports say the keeper hardly moved: at this distance the flight takes about 0.7 s, close to the time needed to react and dive.',
      takeaway: 'Close in, the challenge is height, not distance: the ball must rise over the wall and fall under the bar within about 9 metres.',
      experiment: { param: 'top', label: 'Topspin (rev/s)', values: [0, 2, 4, 6] },
      sources: [
        { title: 'Sports Illustrated: free kick seals hat-trick', url: 'https://www.si.com/soccer/2018/06/15/cristiano-ronaldo-goal-video-spain-portugal-david-de-gea-world-cup' },
        { title: 'FourFourTwo: first major-tournament set piece at the 45th attempt', url: 'https://fourfourtwo.com/news/ronaldo-finally-scores-major-tournament-set-piece-45th-attempt' },
      ],
      recon: { ball: { x: 19.5, y: 2.5 }, kick: { speed: 27, side: -5, top: 3 }, target: { y: -3.25, z: 2.15 }, wall: 4, keeper: 'pro', keeperRooted: true },
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
      id: 'koeman-1992', taker: 'koeman', title: 'Wembley, extra time',
      facts: {
        player: 'Ronald Koeman', for: 'FC Barcelona', opponent: 'Sampdoria', competition: 'European Cup final',
        date: '1992-05-20', venue: 'Wembley Stadium, London', result: '1–0 (after extra time)', minute: '112',
        distance: 'Not consistently reported; the reconstruction uses an estimate.',
        goalkeeper: 'Gianluca Pagliuca',
        wall: 'Not recorded in the sources found. It was an indirect free kick: the ball was touched first before Koeman struck it.',
        how: 'A powerful, low-spin drive past the keeper: the only goal of the final, and Barcelona\'s first European Cup.',
      },
      kits: { attack: { shirt: [0.95, 0.5, 0.12], shirt2: [0.95, 0.5, 0.12], pattern: 0, trim: [0.1, 0.2, 0.55], shorts: [0.95, 0.5, 0.12], socks: [0.95, 0.5, 0.12], number: 4 },
        defence: { shirt: [0.1, 0.28, 0.65], shirt2: [0.95, 0.95, 0.95], pattern: 2, shorts: [0.95, 0.95, 0.95], socks: [0.1, 0.28, 0.65] }, keeper: { shirt: [0.25, 0.25, 0.28], shorts: [0.2, 0.2, 0.22], socks: [0.25, 0.25, 0.28] } },
      moment: 'Goalless after 90 minutes at Wembley; the free kick decided the 1992 European Cup.',
      technique: 'Struck with the laces, power over curve: a classic "driven" free kick.',
      physics: 'At high speed, drag is the dominant aerodynamic force. A driven ball crosses the line sooner, giving the keeper less time, and with little spin it barely curves.',
      keeper: 'A fast, low drive gives the keeper well under a second; the reaction time alone uses up about a third of it.',
      takeaway: 'Time is a weapon: every extra metre per second takes reaction time away from the goalkeeper.',
      experiment: { param: 'speed', label: 'Launch speed (m/s)', values: [25, 29, 33, 36] },
      sources: [
        { title: 'UEFA: 1991/92 — Koeman ends Barcelona\'s wait', url: 'https://www.uefa.com/uefachampionsleague/news/010d-0e6a0d8638ca-890c5087dc01-1000--1991-92-koeman-ends-barcelona-s-wait/' },
        { title: 'FC Barcelona: one of ours, Ronald Koeman', url: 'https://www.fcbarcelona.com/en/news/763938/one-of-ours-ronald-koeman' },
      ],
      recon: { ball: { x: 21, y: -2 }, kick: { speed: 33, side: -1.5, top: -0.5 }, target: { y: 2.6, z: 0.5 }, wall: 4, keeper: 'pro' },
    },
    {
      id: 'mihajlovic-1998', taker: 'mihajlovic', title: 'A hat-trick of free kicks',
      facts: {
        player: 'Siniša Mihajlović', for: 'Lazio', opponent: 'Sampdoria', competition: 'Serie A',
        date: '1998-12-13', venue: 'Stadio Olimpico, Rome', result: '5–2', minute: '29, 45, 52',
        distance: 'One of the three is reported from about 30 m; the reconstruction uses that one.',
        goalkeeper: 'Fabrizio Ferron',
        wall: 'Not recorded in the sources found.',
        how: 'Three direct free kicks in one match: one with a slight deflection, one curled over the wall, one from about 30 m.',
      },
      kits: { attack: { shirt: [0.55, 0.78, 0.92], shirt2: [0.55, 0.78, 0.92], pattern: 0, trim: [0.96, 0.96, 0.96], shorts: [0.95, 0.95, 0.95], socks: [0.55, 0.78, 0.92], number: 11 },
        defence: { shirt: [0.1, 0.25, 0.65], shirt2: [0.95, 0.95, 0.95], pattern: 2, shorts: [0.95, 0.95, 0.95], socks: [0.1, 0.25, 0.65] }, keeper: { shirt: [0.2, 0.2, 0.22], shorts: [0.2, 0.2, 0.22], socks: [0.2, 0.2, 0.22] } },
      moment: 'Only the second hat-trick of free kicks in Serie A, after Giuseppe Signori\'s.',
      technique: 'A left-footed specialist known for power: the ball is struck hard, with enough curl to get around or over the wall.',
      physics: 'Power and curl pull against each other: more speed means a smaller spin parameter S = rω/v for the same spin, so a hard-hit ball curls less unless it is also spun harder.',
      keeper: 'A powerful, curling shot leaves almost no time to adjust once the ball clears the wall.',
      takeaway: 'Repeatability is the real skill: the same physics, three times in one match.',
      experiment: { param: 'side', label: 'Side spin (rev/s)', values: [3, 6, 9, 12] },
      sources: [
        { title: 'Planet Football: an ode to Mihajlović\'s hat-trick of free kicks', url: 'https://www.planetfootball.com/nostalgia/an-ode-to-sinisa-mihajlovics-superb-hat-trick-of-free-kicks-for-lazio' },
        { title: 'Lazio Stories: 13 December 1998, Lazio 5–2 Sampdoria', url: 'https://www.laziostories.com/post/december-13-1998-lazio-sampdoria-5-2' },
      ],
      recon: { ball: { x: 29.5, y: -3 }, kick: { speed: 31, side: 7, top: 1.5 }, target: { y: 3.0, z: 1.9 }, wall: 4, keeper: 'pro' },
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
      id: 'nakamura-2006', taker: 'nakamura', title: 'Celtic Park against United',
      facts: {
        player: 'Shunsuke Nakamura', for: 'Celtic', opponent: 'Manchester United', competition: 'UEFA Champions League, group stage',
        date: '2006-11-21', venue: 'Celtic Park, Glasgow', result: '1–0', minute: '81',
        distance: 'Reported variously as about 25 m and 30 m.',
        goalkeeper: 'Edwin van der Sar',
        wall: 'Not recorded in the sources found. The free kick came from a foul by Nemanja Vidić.',
        how: 'Curled into the top corner, sending Celtic into the knockout stage for the first time.',
      },
      kits: { attack: { shirt: [0.1, 0.55, 0.28], shirt2: [0.96, 0.96, 0.96], pattern: 2, trim: [0.1, 0.55, 0.28], shorts: [0.96, 0.96, 0.96], socks: [0.96, 0.96, 0.96], number: 25 },
        defence: { shirt: [0.75, 0.08, 0.1], shorts: [0.95, 0.95, 0.95], socks: [0.08, 0.08, 0.09] }, keeper: { shirt: [0.2, 0.2, 0.22], shorts: [0.2, 0.2, 0.22], socks: [0.2, 0.2, 0.22] } },
      moment: 'Nine minutes from time in a game Celtic had to win to reach the knockout stage.',
      technique: 'A left-footed curler: precision and spin rather than power.',
      physics: 'At moderate speed a strongly spun ball has a large spin parameter, so the Magnus force is a big fraction of the drag. That is what lets a "placed" free kick bend a long way.',
      keeper: 'A curler aimed outside the post moves away from the keeper as he moves toward it.',
      takeaway: 'Placement beats power when spin does the work.',
      experiment: { param: 'side', label: 'Side spin (rev/s)', values: [4, 7, 9, 11] },
      sources: [
        { title: 'UEFA: Celtic marvel made in Japan', url: 'https://www.uefa.com/uefachampionsleague/news/01bb-0e6dbd7ab81a-c04a1be2109f-1000--celtic-marvel-made-in-japan/' },
        { title: 'RTÉ: Celtic v Manchester United report', url: 'https://www.rte.ie/sport/soccer/2006/1121/211571-celtic' },
      ],
      recon: { ball: { x: 25.5, y: -1.5 }, kick: { speed: 26.5, side: 9, top: 2 }, target: { y: 3.25, z: 2.15 }, wall: 4, keeper: 'pro' },
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
  ];
  return { KICKS };
});
