/*
 * Temporary, browser-only match settings.
 *
 * This file deliberately contains the local test knobs only: the real online
 * room, map choice, simulation and random-map policy remain server concerns.
 * Remove this file together with the offline test flow when that server path is
 * ready; app.js falls back to its original logical canvas values.
 */
window.TankWarTestGame = Object.freeze({
  enabled: true,
  // The 4096px world is viewed through the existing 832x576 logical canvas.
  // .2 shows five times as much terrain in the browser test.
  cameraZoom: 0.2,
  // The browser test uses half-size tanks, including matching collision.
  tankRenderScale: 0.5,
  collisionRadius: 36,

  // ---- In-match music playlist ---------------------------------------------
  // Tracks play one after another and loop back to the first (2-3 tracks is fine). Every new match starts on the
  // next track. A file that is missing is skipped automatically, so you can list a track before adding it.
  gameMusic: Object.freeze([
    'assets/audio/musicongamenew.mp3?v=1',
    'assets/audio/musicongame2.mp3',
    'assets/audio/musicongame3.mp3',
    'assets/audio/musicongame4.mp3',
    'assets/audio/musicongame5.mp3',
    'assets/audio/musicongame6.mp3',
    'assets/audio/musicongame7.mp3'
  ]),

  // ---- Battle sound loudness (1 = original level, lower = quieter) -----------
  sfxMix: Object.freeze({ shot: 0.55, move: 0.55, explosion: 0.6 }),

  // ---- Engagement range -------------------------------------------------
  // 1 stud = 1 maze cell. Enemies are visible (and bots shoot) up to this many
  // studs away. Reduced again from 3 to 2.5 (narrower field of view).
  rangeStuds: 2.5,

  // ---- Bullet range -------------------------------------------------------
  // How far a bullet can fly, as a fraction of the map size (0.5 = half the map). Applies to the offline test.
  bulletRangeMap: 0.3,

  // ---- Respawn / spawn protection / magazine ------------------------------
  playerRespawnSeconds: 5,            // dead time before respawning
  respawnInvulnerableSeconds: 1.5,    // immunity right after respawn
  magazineSize: 6,                    // a respawned tank always starts with a full magazine
  reloadSeconds: 2.2,                 // press R (or empty magazine) to reload

  // ---- Scoring -----------------------------------------------------------
  survivalPointsPerSecond: 3,         // +3 for each full second alive (dead = no points)
  killPoints: 10,                     // +10 per tank destroyed
  shutdownBonus: 20,                  // +20 extra for ending an enemy streak
  streakStartKills: 3,                // an enemy counts as "on a streak" from this many kills without dying
  multiKillWindowSeconds: 15,         // max gap between two kills to keep the chain: Double, Triple, Quadra, Penta (set 9999 = chain only breaks when you die)

  // The match lasts 5 minutes; the highest score wins.
  matchSeconds: 300,
  winKills: Infinity,

  // ---- Team mode (2v2 / 3v3 / 4v4 / 5v5, chosen on the map screen) ---------------
  // Best-of rounds: every round is a death match with NO respawn until the next round.
  // A round ends when one team has no tank left (or when the time is up: more survivors win).
  // The team with the most round wins after all rounds wins the match.
  teamRounds: 5,
  teamRoundSeconds: 120,              // time limit of one round
  teamRoundEndDelaySeconds: 3,        // pause after the last kill of a round; the next round then starts automatically

  // ---- Control zone mode ("Cấm Địa", 3v3 / 5v5, chosen on the map screen) ----------------
  // A capture zone sits in the middle of a slightly bigger map. The team with MORE tanks inside fills its progress bar;
  // equal numbers freeze both bars. Dead tanks respawn at their base after zoneRespawnSeconds.
  zoneMapScale: 1.25,                 // the map is enlarged by this factor (1 = original size)
  zoneRadius: 480,                    // radius of the capture zone (world units; a tank is ~120 wide). Was 600.
  zoneLockSeconds: 10,                // the zone is locked for the first 10 s of the match (tanks can already fight)
  zoneCaptureSeconds: 300,            // seconds to fill 100 % at normal speed (a bit faster than 340: aiming at ~9-12 minute matches)
  zoneSpeedBehindAt50: 1.2,           // once a team reaches 50 %, the team still below 50 % is this much faster until it reaches 50 %
  zoneSpeedAt70: 1.1,                 // a team at 70 % or more is this much faster until the end of the match
  zoneMusicAtPercent: 70,             // assets/audio/70progress.mp3 starts when a team reaches this progress
  zoneContestSeconds: 5,              // when BOTH teams are at 99 %: the team with more tanks inside for this long in a row wins (resets on equal numbers / leaving)
  zoneRespawnSeconds: 5,              // respawn delay in this mode
  zoneShotDelaySeconds: 1.5,          // minimum delay between two shots in this mode (anti-spam)

  // Bot defaults (also selectable on the map screen): 1-10 bots, difficulty easy | medium | hard | extreme.
  localBotCount: 3,
  botDifficulty: 'medium',

  // This is only the temporary local-bot fallback. Online map randomness is
  // intentionally left to the Haskell server and is not exposed in the UI.
  defaultMapId: 'forest',
  localBotNames: Object.freeze(['CPU-ALPHA', 'CPU-BRAVO', 'CPU-DELTA', 'CPU-ECHO', 'CPU-FOXTROT', 'CPU-GOLF', 'CPU-HOTEL', 'CPU-INDIA', 'CPU-JULIET']),
  localMapIds: Object.freeze(['forest', 'ruins', 'depot'])
});
