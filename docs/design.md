# Blue: design

Current state as of 2026-10-20. Live at https://blue.phareim.no.

Blue is a fast solo arcade game. You are a blue comet skimming tiny planets that have their own gravity. Your trail is a lasso: cross it, and everything inside the loop is caught, crushed and painted over in glowing blue. Paint enough of a world and it ignites. A launch star appears; reach it and you are slung through space to the next world, steering into one of three boons on the way. Light every world in the system and you dive into the sun. It goes supernova and throws you into a harder system. Three hearts; the run ends when they are gone.

## Where the ideas came from

The brief was to mash a wide set of games into something fresh. Each piece below came from somewhere specific. None of the games we found puts a lasso on a sphere and slingshots between worlds; that combination is the new part.

| Game | What Blue takes from it |
|---|---|
| Qix (Taito, 1981) | Capture by drawing: close off a region and it is yours |
| Trail Bind (KAYAC), Loop Ranger (GMTK Jam 2025), Pokémon Ranger | The lasso: a loop of your own trail binds what is inside, and caught enemies are pulled together before they pop |
| Paper.io, Splatoon | Captured ground becomes your paint, and coverage is the goal |
| Super Mario Galaxy | Tiny round planets with their own gravity, launch stars, other worlds hanging in the sky |
| Gravity Ghost | Flights between planets on real gravity, bending around bodies on the way |
| Geometry Wars (Pacifism mode) | Neon vector swarms, score that grows with the square of what you catch at once, particle storms |
| slither.io, Tron | You never stop moving; you steer by pointing |
| Vampire Survivors, Hades | Swarms that keep thickening; pick one of three boons between rooms |
| Star Fox, Rez | Rail flight where you steer into what you want; Rez's music building with play |
| Peggle (Extreme Fever), Balatro | Absurd fanfare for big plays: hit-stop, slow motion, a rising chord, MEGA LOOP cards |
| Pac-Man | Blaze, the power pellet: for a few seconds the hunted hunt |
| Outer Wilds | The sun going supernova at the end of each system |
| Interstellar (Gargantua) | The singularity's lens: a black shadow with the world bent into a ring around it |

Checked 2026-10-18: Trail Bind's store listing, the Loop Ranger and Ranger pages on itch.io, and reviews of Gravity Ghost. None of these was played; the rest are well-known games.

## The loop

1. **Land.** A flock of mites arrives with you. You have two seconds of grace.
2. **Loop.** Steer so your trail crosses itself, or comes back within snapping distance of an old point. The loop flares and tightens. Everything inside is caught, and the ground inside is painted. Catching *n* enemies in one loop scores 10·n² × chain × multiplier, so one big loop beats many small ones. Loops within 3.2 s of each other build a chain.
3. **Stardust.** Caught enemies burst into stardust that flies to you once you are close. Stardust fills the flux meter; a full meter starts Blaze.
4. **Ignite.** At the world's paint target (20–32%, more in later systems) a launch star appears ahead, with an arrow when it is off screen.
5. **Fly.** The star throws you along a path simulated through every body's gravity, with homing that grows so you always arrive. Three boon orbs sit side by side partway; the cards at the bottom sit where your finger or cursor steers into each one.
6. **Supernova.** After the last world the flight goes into the sun. The next system has more worlds, new kinds of world, more enemies and higher targets.

## Worlds

Each world bends the physics in its own way. The first system is Azure, Ember, Rime, Mote. The second introduces Bloom, Gemini and Tide; later systems draw from all seven.

| World | Twist |
|---|---|
| Azure | Plain sea and islands, to learn on |
| Ember | Lava vents rumble, then erupt and throw the comet and the swarm skyward |
| Rime | Ice with almost no grip: the comet's velocity lags where it points, so loops drift |
| Bloom | A wave travels around the planet and tosses everything it passes |
| Gemini | Twin planets close together; jump the gap, gravity from both |
| Mote | Tiny, with barely any gravity: a jump becomes a flight over the whole world |
| Tide | A moon orbits low and drags the swarm into a clump beneath it, ready for one huge loop |

## Enemies

| Enemy | Look | Behaviour |
|---|---|---|
| Mite | Magenta diamond | Wanders; drifts toward you when close. Comes in flocks. A bumper: hitting one knocks it flying and bounces you off, and costs your chain |
| Hunter | Orange chevron | Chases you |
| Shear | Red shuriken | Hunts your trail and cuts it |
| Spore | Lime pinwheel | Circles; bursts into a gem when caught |
| Warden | Violet hexagon | Pulses a ring that cuts any trail it reaches |
| Gem | Gold star | Harmless; flees. Worth 250 and a lot of flux |

The warm-coloured enemies (hunter, shear, spore, warden) cost a heart on contact, unless you are in Blaze. Jumping clears them. The first world has only mites, so it is safe to learn on, until hunters start drifting in after 20 s. From the second world on, the warm-coloured enemies join the mix.

## Power-ups (on the ground) and boons (in flight)

Power-ups are orbs you drive over or catch in a loop:
- **Nova:** a blast across a third of the world.
- **Singularity:** a black hole that drags and crushes the swarm.
- **Prism:** two copies of the comet, one either side, drawing their own loops.
- **Chrono:** the swarm slows to a crawl.
- **Blaze:** the same as a full flux meter.
- **+1 heart.**

Boons last the whole run. There are twelve, listed in `src/blue/config.ts`. Examples: Long Tail (longer trail), Lasso (loops close from further away), Arc Lightning (each capture zaps two more), Echo (each loop strikes twice), Ember Tail (your trail burns what touches it), Spring (a double jump).

## Controls

- **Phone:** hold a finger anywhere and the comet heads toward it. A quick tap, or a second finger, jumps. In flight, the finger's position across the screen places the comet.
- **Desktop:** the comet heads toward the mouse cursor, or turn with A/D or the arrows. Click or Space jumps. W/S drift up and down in flight. M mutes, Esc or P pauses.

## How it is built

React only draws the HUD. The game is an imperative Three.js island in `src/blue/`:

| File | What it holds |
|---|---|
| `geo.ts` | Sphere maths: arc crossings, loop detection, the inside test (gnomonic projection), painting loops into equirectangular masks. Tested in `geo.test.ts` |
| `config.ts` | Tuning numbers, worlds, enemies, boons, power-ups |
| `world.ts` | Bodies (one paint mask each), worlds, the star system generator, vents, waves, the tide moon, gravity |
| `trail.ts` | The trail ribbon, loop closing, cuts, the contracting loop flash |
| `player.ts` | The comet: ground movement with grip, jumps, free flight, landing |
| `enemies.ts` | The swarm: movement and behaviour on the sphere, capture animation, instanced drawing |
| `flight.ts` | Building and riding the slingshot path |
| `camera.ts` | Surface, flight and title cameras. The surface view's screen-up is carried along the sphere without turning with the comet, so steering toward a finger stays stable |
| `game.ts` | The run: states, scoring, the spawn director, power-ups, boons, effects |
| `audio.ts` | Procedural music (pad, kick, bass, hats, arpeggio, lead, which build with intensity) and sound effects |
| `fx/` | Shaders (planets, atmosphere, sky, sun, trail, particles), post-processing (bloom, shockwaves, the lens, chromatic aberration, grade), particles, shapes |

The paint is a 512×256 mask per body, read by the planet shader. Coverage is weighted by latitude, so it is true area.

## Checking it

- `pnpm test`: the geometry tests.
- `scripts/lab.mjs`: title, intro, landing and one loop, at desktop and phone sizes. Includes a touch-drag check with a negative touch id.
- `scripts/tour.mjs`: forces a whole run (all four worlds, every flight, the supernova, system 2, each power-up, game over) and logs frame rate per stage.
- `scripts/mac-tour.sh`: runs the tour on the Mac's GPU.

Sleeper has no GPU. There, Chrome only draws WebGL through SwiftShader, at a few frames a second, which is enough for stills. Look and frame rate need the Mac. Last tour, 2026-10-18: 60 fps through every stage at 1440×900 on the Mac. Not measured on an iPhone. The game lowers its pixel ratio by itself when frames run long.
