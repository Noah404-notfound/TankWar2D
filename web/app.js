/* TankWar browser client. No frontend build step is required.
 * Online protocol mirrors Common.Protocol.hs (Aeson Generic tagged encoding).
 * The offline practice mode uses the same canvas renderer but a local simulator
 * driven by the JSON map layouts in assets/maps.
 */
(() => {
  'use strict';

  const WORLD_W = 1344;
  const WORLD_H = 704;
  const TEST_GAME = window.TankWarTestGame || {
    enabled: false, cameraZoom: 1, collisionRadius: 36,
    tankRenderScale: 1, enemyVisibilityRadius: Infinity, playerRespawnSeconds: 5,
    defaultMapId: 'forest', localBotNames: ['CPU-ALPHA', 'CPU-BRAVO', 'CPU-DELTA'], winKills: Infinity
  };
  // Game rules. Every number can be tuned from testgame.js; these are the defaults.
  const RULES = {
    respawnSeconds: Number(TEST_GAME.playerRespawnSeconds ?? 5),
    invulnerableSeconds: Number(TEST_GAME.respawnInvulnerableSeconds ?? 1.5),
    magazineSize: Number(TEST_GAME.magazineSize ?? 6),
    reloadSeconds: Number(TEST_GAME.reloadSeconds ?? 2.2),
    survivalPoints: Number(TEST_GAME.survivalPointsPerSecond ?? 3),
    killPoints: Number(TEST_GAME.killPoints ?? 10),
    shutdownBonus: Number(TEST_GAME.shutdownBonus ?? 20),
    streakStart: Number(TEST_GAME.streakStartKills ?? 3),
    multiKillWindow: Number(TEST_GAME.multiKillWindowSeconds ?? 10),
    rangeStuds: Number(TEST_GAME.rangeStuds ?? 4.5),
    bulletRangeMap: Number(TEST_GAME.bulletRangeMap ?? .3),   // how far a bullet flies, as a fraction of the map size (.5 = half the map)
    matchSeconds: Number(TEST_GAME.matchSeconds ?? 300),
    teamRounds: Math.max(1, Math.round(Number(TEST_GAME.teamRounds ?? 5))),
    teamRoundSeconds: Number(TEST_GAME.teamRoundSeconds ?? 120),
    teamRoundEndDelay: Number(TEST_GAME.teamRoundEndDelaySeconds ?? 5),
    // Control zone mode (Cấm Địa)
    zoneMapScale: Math.max(1, Number(TEST_GAME.zoneMapScale ?? 1.25)),
    zoneRadius: Number(TEST_GAME.zoneRadius ?? 480),
    zoneLockSeconds: Number(TEST_GAME.zoneLockSeconds ?? 10),
    zoneCaptureSeconds: Math.max(10, Number(TEST_GAME.zoneCaptureSeconds ?? 300)),
    zoneSpeedAt70: Number(TEST_GAME.zoneSpeedAt70 ?? 1.1),
    zoneSpeedBehindAt50: Number(TEST_GAME.zoneSpeedBehindAt50 ?? 1.2),
    zoneMusicAt: Number(TEST_GAME.zoneMusicAtPercent ?? 70),
    zoneContestSeconds: Number(TEST_GAME.zoneContestSeconds ?? 5),
    zoneRespawn: Number(TEST_GAME.zoneRespawnSeconds ?? 5),
    zoneShotDelay: Number(TEST_GAME.zoneShotDelaySeconds ?? 1.5)
  };
  const MULTI_TITLES = { 1: 'SLAIN', 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'QUADRA KILL', 5: 'PENTAKILL' };
  // Bot difficulty. speed = px/s in the 1344-wide logical world (the player moves at 150),
  // fire = seconds between shots, aim = random aim error (rad), react = delay before the first shot after
  // spotting a target, range = fraction of the vision range, lead = how well it aims ahead of a moving target,
  // dodge = chance to sidestep an incoming bullet, turn = turret speed (rad/s), think = how often it re-plans.
  const MAX_BOTS = 10;
  const MAX_TEAM_BOTS = 9;   // 5v5 = you + 4 allies + 5 enemies
  const BOT_LEVELS = {
    easy: {
      label: 'EASY', speed: 55, fire: [2.6, 3.6], aim: .5, react: .9, range: .75, lead: 0, los: false, path: false, dodge: 0, strafe: false, hunt: false, turn: 2.5, think: .8,
      hint: 'Bot chậm, ngắm lệch, đi thẳng vào tường và bắn cả khi không nhìn thấy mục tiêu. Bot bắn cả bạn lẫn bot khác.'
    },
    medium: {
      label: 'MEDIUM', speed: 78, fire: [1.6, 2.4], aim: .2, react: .6, range: 1.0, lead: 0, los: true, path: true, dodge: 0, strafe: false, hunt: false, turn: 4.5, think: .6,
      hint: 'Bot biết tìm đường vòng qua tường và chỉ bắn khi nhìn thấy mục tiêu. Bot bắn cả bạn lẫn bot khác.'
    },
    hard: {
      label: 'HARD', speed: 105, fire: [1.0, 1.5], aim: .08, react: .35, range: 1.15, lead: .7, los: true, path: true, dodge: .6, strafe: true, hunt: true, turn: 9, think: .35,
      hint: 'Bot bắn đón đầu, di chuyển né đạn, giữ khoảng cách. Bot bắn cả bạn lẫn bot khác.'
    },
    extreme: {
      label: 'EXTREME', speed: 132, fire: [.6, .95], aim: .025, react: .15, range: 1.3, lead: 1, los: true, path: true, dodge: 1, strafe: true, hunt: true, turn: 22, think: .2,
      hint: 'Bot gần nhanh bằng bạn, ngắm gần như chuẩn, né đạn liên tục và săn mục tiêu gần nhất.'
    }
  };
  const botSettings = {
    difficulty: BOT_LEVELS[TEST_GAME.botDifficulty] ? TEST_GAME.botDifficulty : 'medium',
    bots: Math.max(1, Math.min(MAX_BOTS, Math.round(Number(TEST_GAME.localBotCount ?? 3)))),
    teamSize: 0,   // 0 = free-for-all, 2 / 3 / 4 / 5 = team mode (2v2, 3v3, 4v4, 5v5)
    zone: false,   // control zone mode (Cấm Địa): uses teamSize 3 or 5
    matchSeconds: Number(TEST_GAME.matchSeconds ?? 300),            // free-for-all match length (chosen on the map screen)
    teamRoundSeconds: Number(TEST_GAME.teamRoundSeconds ?? 120),    // team mode: length of one round
    teamRounds: Math.max(1, Math.min(20, Math.round(Number(TEST_GAME.teamRounds ?? 5))))   // team mode: number of rounds (1-20)
  };
  const LOCAL_WORLD_SIZE = 4096;
  const LOCAL_TANK_SIZE = 256;
  const LOCAL_TANK_RADIUS = TEST_GAME.collisionRadius;
  const LOCAL_CAMERA_ZOOM = TEST_GAME.cameraZoom;
  const LOCAL_WALL_THICKNESS = 88;
  const LOCAL_SPEED_SCALE = LOCAL_WORLD_SIZE / WORLD_W;
  const COLORS = {
    TankRed: '#ff655d', TankBlue: '#5ca9ff', TankGreen: '#8ae65e', TankYellow: '#ffd45d',
    red: '#ff655d', blue: '#5ca9ff', green: '#8ae65e', yellow: '#ffd45d'
  };
  const $ = (id) => document.getElementById(id);
  const screens = {
    home: $('home-screen'), map: $('map-screen'), tankSelect: $('tank-select-screen'), lobby: $('lobby-screen'),
    room: $('room-screen'), game: $('game-screen'), results: $('results-screen')
  };
  const canvas = $('game-canvas');
  const ctx = canvas.getContext('2d');
  const input = { up: false, down: false, left: false, right: false, fire: false, mouseX: WORLD_W / 2, mouseY: WORLD_H / 2, reloadRequest: false, reloadPulse: false };
  const imageFiles = {
    hull: 'assets/img/tank-hull.png', gun: 'assets/img/tank-gun.png',
    box: 'assets/items/mysterybox.png',
    boxBroken: 'assets/items/mysteryboxbroken.png',
    rewardBomb: 'assets/items/bomb.png', rewardShield: 'assets/items/shield.png'
  };
  const images = {};
  Object.entries(imageFiles).forEach(([name, src]) => {
    const im = new Image();
    im.src = src;
    images[name] = im;
  });
  const loadImage = src => { const image = new Image(); image.src = src; return image; };
  const heartFrames = [
    loadImage('assets/items/heart-1.bmp'), loadImage('assets/items/heart-2.png'),
    loadImage('assets/items/heart-3.png'), loadImage('assets/items/heart-4.bmp')
  ];
  const bulletEffectFrames = {
    LaserBullet: [
      loadImage('assets/bullets/laser/Sprite_Fire_Shots_Shot_B_000.png'),
      loadImage('assets/bullets/laser/Sprite_Fire_Shots_Shot_B_001.png'),
      loadImage('assets/bullets/laser/Sprite_Fire_Shots_Shot_B_002.png')
    ],
    ShotgunBullet: [
      loadImage('assets/bullets/shotgun/Sprite_Fire_Shots_Impact_A_001.png'),
      loadImage('assets/bullets/shotgun/Sprite_Fire_Shots_Impact_A_002.png'),
      loadImage('assets/bullets/shotgun/Sprite_Fire_Shots_Impact_A_003.png')
    ],
    GatlingBullet: [
      loadImage('assets/bullets/gatling/Sprite_Effects_Exhaust_01_000.png'),
      loadImage('assets/bullets/gatling/Sprite_Effects_Exhaust_01_001.png'),
      loadImage('assets/bullets/gatling/Sprite_Effects_Exhaust_01_002.png')
    ],
    WallPiercingBullet: [
      loadImage('assets/bullets/piercing/Sprite_Fire_Shots_Shot_A_000.png'),
      loadImage('assets/bullets/piercing/Sprite_Fire_Shots_Shot_A_001.png'),
      loadImage('assets/bullets/piercing/Sprite_Fire_Shots_Shot_A_002.png'),
      loadImage('assets/bullets/piercing/Sprite_Fire_Shots_Shot_A_003.png')
    ]
  };
  // Hull / gun picked in the garage. Other tanks keep the default sprites.
  const partImages = {};
  function partImage(kind, id) {
    const key = `${kind}_${id}`;
    if (!partImages[key]) {
      const im = new Image();
      im.src = `assets/tanks/${kind}_${String(id).padStart(2, '0')}.png`;
      partImages[key] = im;
    }
    return partImages[key];
  }
  function spritesFor(tankId) {
    if (isMe(String(tankId || ''))) {
      const hull = partImage('hull', selectedHullId), gun = partImage('gun', selectedGunId);
      return { hull: hull.complete && hull.naturalWidth ? hull : images.hull, gun: gun.complete && gun.naturalWidth ? gun : images.gun };
    }
    const other = tankLoadouts[String(tankId || '')];
    if (other && other.hull && other.gun) {
      const hull = partImage('hull', other.hull), gun = partImage('gun', other.gun);
      return { hull: hull.complete && hull.naturalWidth ? hull : images.hull, gun: gun.complete && gun.naturalWidth ? gun : images.gun };
    }
    return { hull: images.hull, gun: images.gun };
  }
  // The supplied gun sprites already include their own turret assembly.  A
  // one-to-one draw with the hull made that assembly read much larger than the
  // body in the arena, even though it looks balanced in the garage preview.
  const GUN_RENDER_SCALE = .72;
  function drawTankGunSprite(gun, color, turretAngle, width, height) {
    const scale = GUN_RENDER_SCALE;
    ctx.save();
    ctx.rotate(turretAngle + Math.PI / 2);
    drawTinted(gun, color, -width * scale / 2, -height * scale / 2, width * scale, height * scale);
    ctx.restore();
  }
  const hudImages = {};
  Array.from({ length: 10 }, (_, digit) => digit).forEach(digit => {
    const image = new Image();
    image.src = `assets/hud/numbers/${digit}.png`;
    hudImages[`digit-${digit}`] = image;
  });
  Array.from({ length: 8 }, (_, index) => index + 1).forEach(frame => {
    const image = new Image();
    image.src = `assets/hud/loading/Loading${frame}.png`;
    hudImages[`loading-${frame}`] = image;
  });

  let screenName = 'home';
  let mode = 'none';
  let ws = null;
  let wsReady = false;
  let loggedIn = false;
  let displayName = '';
  let username = '';
  let activeRoom = null;
  let isHost = false;
  let roomPlayerNames = [];
  let roomList = [];
  let latestSnapshot = null;
  let latestSnapshotAt = 0;      // performance.now() của snapshot online gần nhất
  let tankLoadouts = {};         // tankId -> { hull, gun } lấy từ snapshot server
  let tankMotion = {};           // tankId -> đang thật sự di chuyển giữa 2 snapshot
  let prevTankPos = {};
  let inputTimer = null;
  let animationId = null;
  let lastFrameTime = 0;
  let fpsFrameCount = 0;
  let fpsLast = performance.now();
  let soundEnabled = true;
  let audioUnlocked = false;
  let currentMusic = '';
  let lastCountdownSecond = null;
  let countdownAudio = null;
  let roundOverlayAction = null;
  let localGame = null;
  let localMap = null;
  let selectedMapId = 'forest';
  let selectedTankColor = 'TankRed';
  let selectedHullId = '05';
  let selectedGunId = '05';
  let tankLoadoutConfirmed = false;
  let tankSelectReturn = 'home';
  // Online rooms use a separate pre-match draft.  It deliberately never
  // reuses the bot settings shown for local practice.
  let mapSelectMode = 'offline';
  let onlineDraft = { players: [], maxPlayers: 4, mode: 'ffa', votes: {}, teams: {}, stage: 'lobby' };
  let mapLoadError = '';
  let lastOnlineUiUpdate = 0;
  let isPaused = false;
  let musicScale = 1;
  let matchClockStart = 0;
  let bannerTimer = 0;
  let lastHudUpdate = 0;
  let myDeathAt = 0;
  let myWasAlive = true;
  let lastKillerOfMe = '';
  let tabHeld = false;
  let lastClockBeep = null, minuteWarnKey = null;
  let firstBloodDone = false;
  // Kill announcements (banner + voice) wait in this queue and play one after another.
  const announceQueue = [];
  let announceBusy = false, announceGen = 0, announceTimer = 0;
  const ANNOUNCE_MIN_MS = 1000;   // every announcement stays at least this long, so its banner can be read
  const ANNOUNCE_BANNER_MS = 3000;   // how long a kill banner stays on screen (3s) when no newer announcement replaces it
  let killAudioCtx = null;
  const killTracker = new Map();
  const streakTracker = new Map();
  const lastKnownStreak = new Map();
  const shotVoices = {};
  let onlineEffects = [];

  const MAP_META = {
    forest: { label: 'FOREST', title: 'RỪNG RẬM', accent: '#b9d66a' },
    ruins: { label: 'RUINS', title: 'PHẾ TÍCH', accent: '#d6a77a' },
    depot: { label: 'DEPOT', title: 'KHO HÀNG', accent: '#d7ad65' }
  };
  const CONTROL_ZONE_MAP = { id: 'camdia', label: 'CẤM ĐỊA', title: 'CHIẾM VÙNG DI ĐỘNG', accent: '#80b8ff', width: 5632, height: 5632 };
  const trainingMaps = new Map();
  const camera = { x: 0, y: 0 };
  // Online maze data always comes from the server snapshot (wsMaze); this is only a fallback.
  const maze = { mazeWidth: WORLD_W, mazeHeight: WORLD_H, mazeWalls: [] };

  const AUDIO_FILES = {
    menu: 'assets/audio/backgroundmenunew.mp3?v=2', endMenu: 'assets/audio/backgroundmenuend.mp3', game: 'assets/audio/musicongamenew.mp3?v=1',
    click: 'assets/audio/clickmouse.mp3', pickup: 'assets/audio/claimitem.mp3',
    countdownTick: 'assets/audio/coutdown.mp3',
    explosion: 'assets/audio/explosion.mp3', winner: 'assets/audio/gamewinner.mp3', gameover: 'assets/audio/gameover.mp3',
    // Team modes (2v2 / 3v3 / 4v4 / 5v5) use their own end jingles; winner / gameover above are for free-for-all.
    winner2: 'assets/audio/gamewinner2.mp3', gameover2: 'assets/audio/gameover2.mp3',
    // Announcer voice ("Victory" / "Defeat") played together with the VICTORY / DEFEAT screen; it is extra, the jingles above stay.
    endVictory: 'assets/audio/end_victory.mp3', endDefeat: 'assets/audio/end_defeat.mp3',
    move: 'assets/audio/tankmove.mp3', normalShot: 'assets/audio/sungshot.mp3',
    laserShot: 'assets/audio/laser.mp3', gatlingShot: 'assets/audio/tieulien.mp3', piercingShot: 'assets/audio/xuyentuong.mp3',
    // Kill announcer voices. Drop your own files with these names into assets/audio/.
    // A missing file falls back to a short built-in synth sound, so nothing breaks.
    // slain = you kill an enemy; defeated = an enemy kills you; enemy_defeated = an enemy kills another enemy.
    slain: 'assets/audio/slain.mp3', defeated: 'assets/audio/defeated.mp3', enemyDefeated: 'assets/audio/enemy_defeated.mp3',
    // Team modes (2v2 / 3v3 / 4v4 / 5v5): our side scores -> enemy_defeated; the enemy scores on our side -> ally_defeated.
    allyDefeated: 'assets/audio/ally_defeated.mp3',
    doubleKill: 'assets/audio/doublekill.mp3', tripleKill: 'assets/audio/triplekill.mp3',
    quadraKill: 'assets/audio/quadrakill.mp3', pentaKill: 'assets/audio/pentakill.mp3',
    // First blood: one shared file for both you and the enemy.
    firstBlood: 'assets/audio/firstblood.mp3',
    // Short alert sounds that come right before the announcer voice (AOV style).
    firstBloodAlert: 'assets/audio/firstblood_alert.mp3',   // First Blood
    allyKillAlert: 'assets/audio/allykill_alert.mp3',       // you or an ally kills an enemy
    enemyKillAlert: 'assets/audio/enemykill_alert.mp3',     // an enemy kills you / an ally / another enemy
    shutdown: 'assets/audio/shutdown.mp3',
    // Last-minute soundtrack: starts the moment 60 seconds remain and loops until the match (or team round) ends.
    oneMinute: 'assets/audio/1mincountdown.mp3',
    // Team modes: announced at the start of a round when a team is one round win away from the match.
    // Control zone mode voices + match music (no 15-minute limit any more).
    zoneOpenVoice: 'assets/audio/zone_open.mp3',        // "The control zone opens in 10 seconds": at the start of the match
    zoneStartVoice: 'assets/audio/zone_start.mp3',      // the moment the zone opens and the clock starts from 00:00
    rateIncrease: 'assets/audio/rate_increase.mp3',     // "The control rate has increased": when a team reaches 50 %
    zoneWar: 'assets/audio/zonewar_music.mp3',          // match music of the control zone mode
    progress70: 'assets/audio/70progress.mp3',   // Control zone mode: starts when a team reaches 70 % progress and plays until the match ends
    matchPoint: 'assets/audio/matchpoint.mp3', matchPoint2: 'assets/audio/matchpoint2.mp3', matchPoint3: 'assets/audio/matchpoint3.mp3',   // one of the three is picked at random once per match and used for every match-point round of that match
    // Team modes: played when your team wipes out the whole enemy team in a round.
    ace: 'assets/audio/ace.mp3',
    enemyAce: 'assets/audio/enemy_ace.mp3',   // the enemy team wipes out your whole team
    // Kill-streak announcements (consecutive kills without dying, when the kills are too far apart for a multi-kill)
    ultimate: 'assets/audio/ultimate.mp3', onslaught: 'assets/audio/onslaught.mp3', bloodbath: 'assets/audio/bloodbath.mp3',
    dominating: 'assets/audio/dominating.mp3', legendary: 'assets/audio/legendary.mp3',
    // The same announcements when an ENEMY scores them (enemy kills an enemy, or kills you).
    enemyDoubleKill: 'assets/audio/enemy_doublekill.mp3', enemyTripleKill: 'assets/audio/enemy_triplekill.mp3',
    enemyQuadraKill: 'assets/audio/enemy_quadrakill.mp3', enemyPentaKill: 'assets/audio/enemy_pentakill.mp3',
    enemyUltimate: 'assets/audio/enemy_ultimate.mp3', enemyOnslaught: 'assets/audio/enemy_onslaught.mp3',
    enemyBloodbath: 'assets/audio/enemy_bloodbath.mp3', enemyDominating: 'assets/audio/enemy_dominating.mp3',
    enemyLegendary: 'assets/audio/enemy_legendary.mp3'
  };
  // 'doubleKill' -> 'enemyDoubleKill' when an enemy earned the announcement.
  const voiceKey = (key, enemy) => enemy ? `enemy${key[0].toUpperCase()}${key.slice(1)}` : key;
  const STREAK_TITLES = { 3: 'ULTIMATE', 4: 'ONSLAUGHT', 5: 'BLOODBATH', 6: 'DOMINATING', 7: 'LEGENDARY' };
  const STREAK_SOUNDS = { 3: 'ultimate', 4: 'onslaught', 5: 'bloodbath', 6: 'dominating', 7: 'legendary' };
  const MULTI_SOUNDS = { 2: 'doubleKill', 3: 'tripleKill', 4: 'quadraKill', 5: 'pentaKill' };
  const musicTracks = {
    menu: createLoopingAudio(AUDIO_FILES.menu, .28),
    game: createLoopingAudio(AUDIO_FILES.game, 1.00),
    results: createLoopingAudio(AUDIO_FILES.endMenu, .30),
    countdown: createLoopingAudio(AUDIO_FILES.oneMinute, 1.00),
    matchpoint: createLoopingAudio(AUDIO_FILES.matchPoint, 1.00),
    matchpoint2: createLoopingAudio(AUDIO_FILES.matchPoint2, 1.00),
    matchpoint3: createLoopingAudio(AUDIO_FILES.matchPoint3, 1.00),
    progress70: createLoopingAudio(AUDIO_FILES.progress70, 1.00),
    zonewar: createLoopingAudio(AUDIO_FILES.zoneWar, 1.00)
  };
  let zoneBoostActive = false, zoneBoostBroken = false, zoneWarBroken = false;
  musicTracks.zonewar.addEventListener('error', () => { zoneWarBroken = true; syncMusicForScreen(); });   // missing file: the normal game playlist plays instead
  musicTracks.progress70.addEventListener('error', () => { zoneBoostBroken = true; zoneBoostActive = false; syncMusicForScreen(); });   // missing file: keep the normal music
  let countdownActive = false, countdownBroken = false;
  // Set when the match ends: the in-match music (playlist, 1-minute track, match-point track) is cut at once and stays off
  // until the player leaves the gameplay screen.
  let battleMusicStopped = false;
  function stopBattleMusic() {
    battleMusicStopped = true;
    zoneBoostActive = false;
    ['game', 'countdown', 'matchpoint', 'matchpoint2', 'matchpoint3', 'progress70', 'zonewar'].forEach(name => { musicTracks[name].pause(); musicTracks[name].currentTime = 0; });
    currentMusic = 'silence';
  }
  // Team modes: in a match-point round, matchpoint.mp3 is the ONLY music (it replaces the game playlist and the 1-minute track) until the round ends.
  // matchpoint.mp3, matchpoint2.mp3 or matchpoint3.mp3 is picked at random per match-point round; a missing file is skipped.
  let matchPointActive = false, matchPointTrack = 'matchpoint';
  const matchPointBrokenNames = new Set();
  let matchPointChoice = null;   // the track picked for THIS match: random once, then the same one every match-point round
  function pickMatchPointTrack() {
    if (matchPointChoice && !matchPointBrokenNames.has(matchPointChoice)) return matchPointChoice;
    const ok = ['matchpoint', 'matchpoint2', 'matchpoint3'].filter(name => !matchPointBrokenNames.has(name));
    matchPointChoice = ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
    return matchPointChoice;   // null = both files missing: keep the normal music
  }
  ['matchpoint', 'matchpoint2', 'matchpoint3'].forEach(name => musicTracks[name].addEventListener('error', () => {
    matchPointBrokenNames.add(name);
    if (matchPointActive && matchPointTrack === name) { matchPointTrack = pickMatchPointTrack(); matchPointActive = !!matchPointTrack; }
    syncMusicForScreen();
  }));
  musicTracks.countdown.addEventListener('error', () => { countdownBroken = true; countdownActive = false; syncMusicForScreen(); });   // missing file: keep the normal music
  // Loudness of the battle sounds (1 = old level). Lower = quieter; tune in testgame.js -> sfxMix.
  const SFX_MIX = Object.assign({ shot: .55, move: .55, explosion: .6 }, TEST_GAME.sfxMix || {});
  const movementTrack = createLoopingAudio(AUDIO_FILES.move, .13 * SFX_MIX.move);
  // In-match music playlist: tracks cycle in order (testgame.js -> gameMusic); a missing file is skipped.
  const gameTrack = musicTracks.game;
  gameTrack._list = (Array.isArray(TEST_GAME.gameMusic) && TEST_GAME.gameMusic.length) ? TEST_GAME.gameMusic.slice(0, 12)
    : [AUDIO_FILES.game, 'assets/audio/musicongame2.mp3', 'assets/audio/musicongame3.mp3'];   // default playlist even without testgame.js
  gameTrack._i = Math.floor(Math.random() * gameTrack._list.length);
  gameTrack._fails = 0;
  gameTrack.loop = gameTrack._list.length === 1;
  function playGameTrack(index) {
    const list = gameTrack._list;
    gameTrack._i = ((index % list.length) + list.length) % list.length;
    gameTrack.src = list[gameTrack._i];
    gameTrack.load();
    if (soundEnabled && audioUnlocked && screenName === 'game' && !battleMusicStopped) gameTrack.play().catch(() => { });
  }
  if (gameTrack._list.length > 1) {
    gameTrack.src = gameTrack._list[gameTrack._i];
    gameTrack.addEventListener('playing', () => { gameTrack._fails = 0; });
    gameTrack.addEventListener('ended', () => playGameTrack(gameTrack._i + 1));
    gameTrack.addEventListener('error', () => {
      if (++gameTrack._fails <= gameTrack._list.length) playGameTrack(gameTrack._i + 1);   // skip a missing / broken file
    });
  }


  const mapLoadPromise = loadTrainingMaps().catch(error => {
    mapLoadError = error && error.message ? error.message : 'Không đọc được dữ liệu map.';
    return null;
  });

  async function loadTrainingMaps() {
    const ids = Object.keys(MAP_META);
    await Promise.all(ids.map(async id => {
      const response = await fetch(`assets/maps/${id}_layout.json`, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Không tải được layout ${id.toUpperCase()} (${response.status}).`);
      const source = await response.json();
      const image = new Image();
      image.src = `assets/maps/${id}_maze_4096.png`;
      trainingMaps.set(id, normaliseTrainingMap(id, source, image));
    }));
    trainingMaps.set(CONTROL_ZONE_MAP.id, createControlZoneMap());
  }

  function controlZoneImage(file) {
    const image = new Image();
    image.src = `assets/maps/${file}`;
    return image;
  }

  // A dedicated 5632 x 5632 battlefield for Cấm Địa.  Every supplied terrain
  // image is stamped repeatedly across the map in an 8 x 8 terrain grid; this
  // deliberately avoids turning four source files into four huge colour
  // quadrants.  Scenery is drawn from the supplied forest, ruins and depot
  // assets instead of a generated texture.
  function createControlZoneMap() {
    const art = {
      slate: controlZoneImage('camdia_slate.png'), charcoal: controlZoneImage('camdia_charcoal.png'),
      olive: controlZoneImage('camdia_olive.png'), rust: controlZoneImage('camdia_rust.png'),
      rock: controlZoneImage('control-zone-props/rock.png'), bush: controlZoneImage('control-zone-props/bush.png'),
      tree: controlZoneImage('control-zone-props/tree.png'), ruin: controlZoneImage('control-zone-props/ruin.png'),
      container: controlZoneImage('control-zone-props/container.png')
    };
    const terrainSize = 704;
    const terrainKeys = ['slate', 'charcoal', 'olive', 'rust'];
    const terrainPatches = [];
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        // A stable, low-frequency pattern produces natural groups of ground
        // types instead of a noisy checkerboard, while using each texture
        // many times throughout the 5632 x 5632 map.
        const field = Math.sin(col * 1.41 + row * .53)
          + Math.cos(row * 1.17 - col * .31)
          + Math.sin((col + row) * .72) * .42;
        const key = field > 1.08 ? terrainKeys[3]
          : field > .28 ? terrainKeys[2]
            : field > -.64 ? terrainKeys[1] : terrainKeys[0];
        terrainPatches.push({ key, x: col * terrainSize, y: row * terrainSize, size: terrainSize });
      }
    }
    const scene = [
      ['tree', 830, 470, 270, 0], ['tree', 215, 1040, 250, 0],
      ['rocks', 1080, 1660, 250, 0], ['bushes', 510, 2500, 390, 0],
      ['container', 2170, 1290, 340, Math.PI / 2], ['bushes', 2080, 2020, 280, 0],
      ['rocks', 2350, 2810, 230, 0], ['container', 1480, 3250, 340, Math.PI / 2],
      ['ruin', 3650, 1570, 360, 0], ['ruin', 3310, 2260, 330, 0],
      ['bushes', 3430, 1120, 310, 0], ['container', 4260, 3500, 340, Math.PI / 2],
      ['bushes', 4720, 3750, 400, 0], ['rocks', 3580, 4030, 230, 0],
      ['ruin', 2030, 4450, 350, 0], ['ruin', 1420, 5050, 350, 0],
      ['bushes', 1900, 5200, 260, 0], ['container', 3390, 4950, 340, Math.PI / 2],
      ['rocks', 4600, 4680, 260, 0], ['tree', 5260, 5370, 250, 0], ['tree', 4870, 5480, 240, 0]
    ];
    const collisionRects = scene.filter(([kind]) => !['tree'].includes(kind)).map(([, x, y, size]) => ({
      x: x - size * .35, y: y - size * .28, width: size * .7, height: size * .56, kind: 'scenery'
    }));
    return {
      ...CONTROL_ZONE_MAP,
      cellSize: 352, gridOffset: 0, tankSize: LOCAL_TANK_SIZE, tankScale: 1,
      wallThickness: LOCAL_WALL_THICKNESS, wallRects: [], blockedRects: [], collisionRects,
      spawns: [{ vx: 410, vy: 410 }, { vx: 5222, vy: 5222 }, { vx: 5222, vy: 410 }, { vx: 410, vy: 5222 }],
      art, scene, terrainPatches, _nav: null
    };
  }

  function normaliseTrainingMap(id, source, background) {
    const number = value => Number(value || 0);
    const width = number(source.width) || LOCAL_WORLD_SIZE;
    const height = number(source.height) || LOCAL_WORLD_SIZE;
    const cellSize = number(source.cell_size) || 352;
    const gridOffset = number(source.grid_offset) || 112;
    const wallRects = (source.wall_rectangles || []).map(rect => ({
      x: number(rect.x), y: number(rect.y), width: number(rect.width), height: number(rect.height), kind: 'wall'
    }));
    const blockedRects = (source.blocked_cells || []).map(cell => {
      const col = number(cell[0]), row = number(cell[1]);
      return { x: gridOffset + col * cellSize, y: gridOffset + row * cellSize, width: cellSize, height: cellSize, kind: 'blocked' };
    });
    const spawns = (source.spawn_centres || []).map(point => ({ vx: number(point[0]), vy: number(point[1]) }));
    return {
      id, label: MAP_META[id].label, title: MAP_META[id].title, accent: MAP_META[id].accent,
      width, height, cellSize, gridOffset,
      tankSize: number(source.tank_reference_size) || LOCAL_TANK_SIZE,
      tankScale: number(source.tank_render_scale) || 1,
      wallThickness: number(source.wall_thickness) || LOCAL_WALL_THICKNESS,
      wallRects, blockedRects, collisionRects: wallRects.concat(blockedRects), spawns, background
    };
  }

  // ---------------------------------------------------------------- audio

  function createLoopingAudio(src, volume) {
    const track = new Audio(src);
    track.preload = 'auto';
    track.loop = true;
    track._baseVolume = volume;
    track.volume = volume;
    return track;
  }

  function applyMusicVolume() {
    Object.values(musicTracks).forEach(track => { track.volume = Math.max(0, Math.min(1, track._baseVolume * musicScale)); });
  }

  // Long one-shot samples (laser, gatling, piercing) must never overlap or repeat.
  // One <audio> voice per sample: a new shot restarts it, and the tail is faded out
  // after a hard cap so a long file can no longer sound like a loop.
  const SHOT_MAX_MS = { laserShot: 850, gatlingShot: 700, piercingShot: 900 };

  function playShot(name, volume = .45) {
    if (!soundEnabled || !audioUnlocked || !AUDIO_FILES[name]) return;
    let voice = shotVoices[name];
    if (!voice) {
      const audio = new Audio(AUDIO_FILES[name]);
      audio.preload = 'auto';
      voice = shotVoices[name] = { audio, timer: 0, fade: 0 };
    }
    const audio = voice.audio;
    clearTimeout(voice.timer); clearInterval(voice.fade);
    audio.loop = false;
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    audio.play().catch(() => { });
    const maxMs = SHOT_MAX_MS[name] || 800;
    voice.timer = setTimeout(() => {
      let level = volume;
      voice.fade = setInterval(() => {
        level -= volume / 6;
        if (level <= .02) { clearInterval(voice.fade); audio.pause(); audio.currentTime = 0; }
        else audio.volume = level;
      }, 25);
    }, Math.max(100, maxMs - 150));
  }

  // Announcer voice: one channel. `done` is called once when the voice has ended (or failed / is disabled),
  // so the announcement queue can start the next one.
  let currentVoice = null, currentVoiceNode = null;
  // Announcer voices and kill alerts are decoded into memory (Web Audio) so they start the instant the banner appears,
  // with no <audio> loading delay. If a file can't be decoded the old <audio> path is used instead.
  let fxCtx = null;
  const fxBuffers = {}, fxLoading = {};
  function fxContext() {
    try { fxCtx = fxCtx || new (window.AudioContext || window.webkitAudioContext)(); if (fxCtx.state === 'suspended') fxCtx.resume(); } catch (e) { fxCtx = null; }
    return fxCtx;
  }
  function loadFxBuffer(name) {
    if (fxBuffers[name] !== undefined || fxLoading[name] || !AUDIO_FILES[name] || !fxContext()) return;
    fxLoading[name] = true;
    fetch(AUDIO_FILES[name]).then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error('missing')))
      .then(data => new Promise((ok, fail) => fxCtx.decodeAudioData(data, ok, fail)))
      .then(buffer => { fxBuffers[name] = buffer; })
      .catch(() => { fxBuffers[name] = null; });
  }
  function playFxBuffer(name, volume, onEnd) {
    const buffer = fxBuffers[name]; if (!buffer || !fxContext()) return null;
    const source = fxCtx.createBufferSource(), gain = fxCtx.createGain();
    source.buffer = buffer; gain.gain.value = volume;
    source.connect(gain); gain.connect(fxCtx.destination);
    if (onEnd) source.onended = onEnd;
    source.start();
    return source;
  }
  const voiceTemplates = {};
  // Announcer files are fetched/decoded ahead of time so a kill voice starts instantly instead of after a load delay.
  function preloadVoices() {
    Object.keys(AUDIO_FILES).forEach(name => {
      if (voiceTemplates[name] || !/^(slain|defeated|enemyDefeated|allyDefeated|doubleKill|tripleKill|quadraKill|pentaKill|firstBlood|firstBloodAlert|allyKillAlert|shutdown|matchPoint|ace|ultimate|onslaught|bloodbath|dominating|legendary|enemy[A-Z].*)$/.test(name)) return;
      const a = new Audio(AUDIO_FILES[name]); a.preload = 'auto'; try { a.load(); } catch (e) { }
      voiceTemplates[name] = a;
      loadFxBuffer(name);
    });
  }
  preloadVoices();   // start fetching + decoding every announcer voice and alert right away, so none of them is late in a match
  const VOICE_MAX_MS = 5000;   // never let a stuck or very long file block the queue
  function playVoice(name, volume = .7, fallback = null, done = null) {
    let finished = false, guard = 0;
    const finish = () => { if (finished) return; finished = true; clearTimeout(guard); if (done) done(); };
    if (!soundEnabled || !audioUnlocked || !AUDIO_FILES[name]) { finish(); return; }
    if (currentVoice) { currentVoice.pause(); currentVoice = null; }
    if (currentVoiceNode) { try { currentVoiceNode.onended = null; currentVoiceNode.stop(); } catch (e) { } currentVoiceNode = null; }
    if (fxBuffers[name]) {
      guard = setTimeout(finish, VOICE_MAX_MS);
      currentVoiceNode = playFxBuffer(name, volume, finish);
      if (currentVoiceNode) return;
    }
    const audio = voiceTemplates[name] ? voiceTemplates[name].cloneNode(true) : new Audio(AUDIO_FILES[name]);
    audio.volume = volume;
    currentVoice = audio;
    guard = setTimeout(finish, VOICE_MAX_MS);
    let fell = false;
    const useFallback = () => { if (!fell) { fell = true; if (fallback) fallback(); finish(); } };
    audio.addEventListener('ended', finish, { once: true });
    audio.addEventListener('error', useFallback, { once: true });
    audio.play().catch(error => { if (error && error.name === 'NotSupportedError') useFallback(); else finish(); });
  }

  function queueAnnouncementBase(item) { queueAnnouncement(item); }
  function queueAnnouncement(item) {
    // A plain kill voice is only worth hearing right away: drop older plain voices still waiting, so they don't pile up and play late.
    if (!item.banner) for (let i = announceQueue.length - 1; i >= 0; i--) if (!announceQueue[i].banner) announceQueue.splice(i, 1);
    announceQueue.push(item);
    while (announceQueue.length > 60) announceQueue.shift();   // effectively unlimited: every announcement is shown, one after another
  }

  // Plays the queued announcements in order: show the banner, speak the voice, then move on to the next one.
  function playAlert(name, volume = .8) {
    if (!soundEnabled || !audioUnlocked || !AUDIO_FILES[name]) return;
    if (playFxBuffer(name, volume)) return;
    const sound = voiceTemplates[name] ? voiceTemplates[name].cloneNode(true) : new Audio(AUDIO_FILES[name]);
    sound.volume = volume;
    sound.play().catch(() => { });
  }
  // Delay (ms) between each alert sound and the announcer voice that follows it (the banner and the alert always start together).
  // 0 = the voice starts with the alert. A short gap (about 100-200 ms) keeps the two from blurring into one.
  const ALERT_VOICE_DELAY_MS = { allyKillAlert: 100, enemyKillAlert: 100, firstBloodAlert: 100 };   // 0 = the announcer voice and the alert sound start together
  const ANNOUNCE_BANNER_DELAY_MS = 200;   // the banner appears this long after the voice / alert sound start
  function runAnnouncements() {
    if (announceBusy) return;
    const item = announceQueue.shift();
    if (!item) return;
    announceBusy = true;
    const gen = announceGen;
    let voiceDone = !item.voice, timeDone = false;
    const next = () => {
      if (gen !== announceGen || !voiceDone || !timeDone) return;
      announceBusy = false;
      runAnnouncements();
    };
    if (item.banner) { const b = item.banner.slice(); b[4] = Math.max(Number(b[4]) || 0, ANNOUNCE_BANNER_MS); setTimeout(() => { if (gen === announceGen) showKillBanner(...b); }, ANNOUNCE_BANNER_DELAY_MS); }   // banner stays longer; the gap to the next announcement is still ANNOUNCE_MIN_MS
    if (item.banner) announceTimer = setTimeout(() => { timeDone = true; next(); }, ANNOUNCE_BANNER_DELAY_MS + ANNOUNCE_MIN_MS); else timeDone = true;   // voice-only items don't need to hold a banner
    if (item.alert) playAlert(item.alert);   // the alert "ping / gong" starts together with the banner
    const speak = () => playVoice(item.voice, item.vol, item.fallback, () => { voiceDone = true; next(); });
    if (item.voice) { if (item.alert && ALERT_VOICE_DELAY_MS[item.alert] > 0) setTimeout(() => { if (gen === announceGen) speak(); }, ALERT_VOICE_DELAY_MS[item.alert]); else speak(); }   // the announcer voice starts with the banner
  }

  function resetAnnouncements() {
    announceGen++;
    announceQueue.length = 0;
    announceBusy = false;
    clearTimeout(announceTimer);
    if (currentVoice) { currentVoice.pause(); currentVoice = null; }
    if (currentVoiceNode) { try { currentVoiceNode.onended = null; currentVoiceNode.stop(); } catch (e) { } currentVoiceNode = null; }
  }

  function stopShotSounds() {
    Object.values(shotVoices).forEach(voice => {
      clearTimeout(voice.timer); clearInterval(voice.fade);
      voice.audio.pause(); voice.audio.currentTime = 0;
    });
  }

  // Small synthesised sting for kills: more notes for a higher multi-kill, falling tone for a shutdown.
  function playKillSting(level = 1, shutdown = false) {
    if (!soundEnabled || !audioUnlocked) return;
    try {
      killAudioCtx = killAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (killAudioCtx.state === 'suspended') killAudioCtx.resume();
      const notes = shutdown && level < 2 ? [392, 330, 262] : [523, 587, 659, 784, 1047].slice(0, Math.max(1, Math.min(5, level)));
      notes.forEach((freq, i) => {
        const t = killAudioCtx.currentTime + i * .085;
        const osc = killAudioCtx.createOscillator(), gain = killAudioCtx.createGain();
        osc.type = shutdown && level < 2 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(.0001, t);
        gain.gain.exponentialRampToValueAtTime(.16, t + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, t + (i === notes.length - 1 ? .42 : .14));
        osc.connect(gain); gain.connect(killAudioCtx.destination);
        osc.start(t); osc.stop(t + .45);
      });
    } catch (_) { }
  }

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    fxContext();   // resume the audio engine (the buffers were already decoded in the background)
    preloadVoices();
    syncMusicForScreen();
  }

  function playSfx(name, volume = .55) {
    if (!soundEnabled || !audioUnlocked || !AUDIO_FILES[name]) return;
    const sound = new Audio(AUDIO_FILES[name]);
    sound.preload = 'auto';
    sound.volume = volume;
    sound.play().catch(() => { });
  }

  // coutdown.mp3 already contains a full countdown cue (about four seconds).
  // It must start once per countdown, not once per number, otherwise the clips overlap.
  function startCountdownSound() {
    if (countdownAudio || !soundEnabled || !audioUnlocked || !AUDIO_FILES.countdownTick) return;
    const sound = new Audio(AUDIO_FILES.countdownTick);
    sound.preload = 'auto';
    sound.volume = .46;
    sound.addEventListener('ended', () => { if (countdownAudio === sound) countdownAudio = null; }, { once: true });
    countdownAudio = sound;
    sound.play().catch(() => { if (countdownAudio === sound) countdownAudio = null; });
  }

  function stopCountdownSound() {
    if (!countdownAudio) return;
    countdownAudio.pause();
    countdownAudio.currentTime = 0;
    countdownAudio = null;
  }

  // Win / lose jingle: gamewinner / gameover for free-for-all (and online), gamewinner2 / gameover2 for the team modes
  // (2v2, 3v3, 4v4, 5v5).
  function playEndSfx(won, volume = .66, team = false) {
    playSfx(team ? (won ? 'winner2' : 'gameover2') : (won ? 'winner' : 'gameover'), volume);
  }

  // ---- Full-screen phase overlays (offline): pre-match countdown and the VICTORY / DEFEAT screen ----
  let endSplash = null, countdownBox = null, countdownShown = null;
  function removeCountdownOverlay() {
    if (countdownBox) { countdownBox.remove(); countdownBox = null; countdownShown = null; }
    stopCountdownSound();
  }
  function updateCountdownOverlay(seconds) {
    const n = Math.max(1, Math.ceil(seconds));
    if (!countdownBox) {
      countdownBox = document.createElement('div');
      countdownBox.className = 'phase-overlay countdown';
      countdownBox.innerHTML = '<div class="phase-sub">GAME STARTS IN</div><div class="phase-main"></div>';
      document.body.appendChild(countdownBox);
      startCountdownSound();
    }
    if (countdownShown !== n) {
      countdownShown = n;
      const main = countdownBox.querySelector('.phase-main');
      main.textContent = String(n);
      main.classList.remove('tick'); void main.offsetWidth; main.classList.add('tick');   // restart the pulse every second
    }
  }
  function hideEndSplash() { if (endSplash) { clearTimeout(endSplash.timer); endSplash.box.remove(); endSplash = null; } }
  // The match is already frozen (gameOver) when this runs; `proceed` opens the results screen once the player clicks / presses a key.
  function showEndSplash(outcome, proceed) {
    hideEndSplash();
    stopBattleMusic();   // battle music stops immediately...
    if (outcome === 'win') playSfx('endVictory', 1);        // ...and the announcer voice starts together with the splash
    else if (outcome === 'lose') playSfx('endDefeat', 1);
    const box = document.createElement('div');
    box.className = `phase-overlay end ${outcome}`;
    box.innerHTML = '<div class="phase-main"></div><div class="phase-sub" hidden>Nhấn để tiếp tục</div>';
    box.querySelector('.phase-main').textContent = outcome === 'win' ? 'VICTORY' : outcome === 'lose' ? 'DEFEAT' : 'DRAW';
    document.body.appendChild(box);
    const state = { box, ready: false, proceed, timer: 0 };
    state.timer = setTimeout(() => { state.ready = true; box.querySelector('.phase-sub').hidden = false; }, 5000);
    endSplash = state;
  }
  ['keydown', 'keyup', 'mousedown', 'mouseup', 'click', 'contextmenu', 'wheel'].forEach(type => {
    window.addEventListener(type, event => {
      if (!endSplash) return;
      event.stopImmediatePropagation(); event.preventDefault();   // nothing reaches the game while the end screen is up
      if ((type === 'click' || type === 'keydown') && endSplash.ready) { const s = endSplash; hideEndSplash(); s.proceed(); }
    }, true);
  });

  function setMovementSound(isMoving) {
    if (!soundEnabled || !audioUnlocked || !isMoving) {
      movementTrack.pause();
      movementTrack.currentTime = 0;
      return;
    }
    movementTrack.play().catch(() => { });
  }

  function syncMusicForScreen() {
    const wanted = screenName === 'game' ? (battleMusicStopped ? 'silence' : matchPointActive ? matchPointTrack : zoneBoostActive ? 'progress70' : (mode === 'offline' && localGame && localGame.zone && !zoneWarBroken) ? 'zonewar' : countdownActive ? 'countdown' : 'game') : screenName === 'results' ? 'results' : 'menu';
    Object.entries(musicTracks).forEach(([name, track]) => {
      if (!soundEnabled || !audioUnlocked || name !== wanted) {
        track.pause();
        if (name !== wanted) track.currentTime = 0;
      }
    });
    if (soundEnabled && audioUnlocked && currentMusic !== wanted) {
      currentMusic = wanted;
      if (wanted === 'game' && gameTrack._list.length > 1) playGameTrack(gameTrack._i + 1);   // each match starts on the next track
      else if (musicTracks[wanted]) musicTracks[wanted].play().catch(() => { });
    } else if (!soundEnabled) {
      currentMusic = '';
    }
  }

  function refreshSoundToggle() {
    const button = $('sound-toggle');
    button.style.color = soundEnabled ? 'var(--lime)' : 'var(--muted)';
    button.textContent = soundEnabled ? '♫' : '♩';
    button.title = soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh';
    button.setAttribute('aria-label', button.title);
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    refreshSoundToggle();
    updatePauseSoundLabel();
    setMovementSound(false);
    syncMusicForScreen();
    if (soundEnabled) playSfx('click', .3);
  }

  // ---------------------------------------------------------------- screens

  function showScreen(name) {
    screenName = name;
    Object.entries(screens).forEach(([key, el]) => { el.hidden = key !== name; });
    document.body.classList.toggle('in-game', name === 'game');
    if (name !== 'game') { document.body.classList.remove('mouse-pressed', 'player-dead', 'offline-gray'); battleMusicStopped = false; }
    if (name === 'game') startRenderLoop();
    else stopRenderLoop();
    syncMusicForScreen();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (name === 'game') {
      hidePauseModal();
      resizeCanvasBacking();
      setTimeout(resizeCanvasBacking, 50);
      setTimeout(resizeCanvasBacking, 180);
      if (mode === 'online') startInputSender();
    } else {
      hidePauseModal();
      stopInputSender();
      stopShotSounds();
      showTabScoreboard(false);
      resizeCanvasBacking();
    }
  }

  // A browser only grants native fullscreen from a user gesture. The local test
  // flow calls this immediately from its confirmation button; CSS still fills
  // the available viewport if a browser declines the native request.
  function enterGameplayFullscreen() {
    const root = document.documentElement;
    if (document.fullscreenElement || !root.requestFullscreen) return;
    root.requestFullscreen().catch(() => { });
  }

  function leaveGameplayFullscreen() {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => { });
  }

  function statusPill(state, text) {
    const el = $('connection-pill');
    el.className = `status-pill ${state}`;
    $('connection-text').textContent = text;
  }

  function setError(target, text) {
    const el = $(target);
    el.textContent = text;
    el.hidden = !text;
  }

  // ---------------------------------------------------------------- protocol helpers

  function readField(obj, key) {
    if (!obj || typeof obj !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    // Tolerate both default Aeson record labels (clUsername) and prefix-stripped labels (username).
    const unprefixed = key.length > 2 ? key.slice(2) : key;
    const plain = unprefixed ? unprefixed[0].toLowerCase() + unprefixed.slice(1) : unprefixed;
    if (Object.prototype.hasOwnProperty.call(obj, plain)) return obj[plain];
    return undefined;
  }

  function tagOf(value) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    if (typeof value.tag === 'string') return value.tag;
    const keys = Object.keys(value);
    if (keys.length === 1) return keys[0];
    return '';
  }

  function contentsOf(msg) {
    if (!msg || typeof msg !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(msg, 'contents')) return msg.contents;
    const keys = Object.keys(msg);
    if (keys.length === 1) return msg[keys[0]];
    if (Object.prototype.hasOwnProperty.call(msg, 'tag')) return msg;
    return undefined;
  }

  function unwrapOne(value) {
    return Array.isArray(value) && value.length === 1 ? value[0] : value;
  }

  function stringPayload(data) {
    if (typeof data === 'string') return data;
    if (Array.isArray(data) && typeof data[0] === 'string') return data[0];
    if (data && typeof data === 'object') return data.message || data.error || data.contents || '';
    return '';
  }

  function sendMessage(tag, contents) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    let message;
    if (tag === 'CPlayerInput') {
      message = { tag, contents };
    } else if (contents && typeof contents === 'object' && !Array.isArray(contents)) {
      message = { tag, ...contents };
    } else if (contents !== undefined) {
      message = { tag, contents };
    } else {
      message = { tag };
    }
    try { ws.send(JSON.stringify(message)); return true; }
    catch (error) { addFeed(`Không gửi được gói tin: ${error.message}`, 'warn'); return false; }
  }

  // ---------------------------------------------------------------- online connection

  function connectOnline() {
    unlockAudio();
    setError('home-error', '');
    const rawName = $('player-name').value.trim() || localStorage.getItem('tankwar-name') || 'TankPilot';
    const url = $('server-url').value.trim();
    $('player-name').value = rawName;
    if (!/^wss?:\/\//i.test(url)) { setError('home-error', 'Địa chỉ server phải bắt đầu bằng ws:// hoặc wss://'); $('server-url').focus(); return; }
    closeSocket(false);
    username = rawName;
    displayName = rawName;
    tankLoadoutConfirmed = false;
    localStorage.setItem('tankwar-name', rawName);
    localStorage.setItem('tankwar-server', url);
    $('online-button').disabled = true;
    $('online-button').setAttribute('aria-label', 'Đang mở danh sách phòng');
    let socket;
    try { socket = new WebSocket(url); }
    catch (error) { resetConnectButton(); statusPill('idle', 'CHƯA KẾT NỐI SERVER'); setError('home-error', `Không tạo được kết nối WebSocket: ${error.message}`); return; }
    ws = socket;
    const timeout = window.setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN && ws === socket) {
        socket.close();
        resetConnectButton();
        statusPill('idle', 'CHƯA KẾT NỐI SERVER');
        setError('home-error', 'Không kết nối được server. Hãy kiểm tra server game, địa chỉ WebSocket và cổng đã mở.');
      }
    }, 8000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      wsReady = true;
      statusPill('idle', 'SẴN SÀNG TÌM PHÒNG');
      // The server requires CLogin to be the first client message.
      sendMessage('CLogin', { clUsername: rawName, clDisplayName: displayName });
    });
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); }
      catch (_) { addFeed('Server gửi dữ liệu không phải JSON.', 'warn'); return; }
      handleServerMessage(message);
    });
    socket.addEventListener('error', () => {
      statusPill('idle', 'LỖI KẾT NỐI');
      if (screenName === 'home') setError('home-error', 'Kết nối WebSocket thất bại. Kiểm tra địa chỉ và trạng thái server.');
    });
    socket.addEventListener('close', () => {
      if (ws !== socket) return;
      wsReady = false; loggedIn = false; resetConnectButton();
      statusPill('idle', 'SẴN SÀNG KẾT NỐI');
      if (screenName === 'game' && mode === 'online') {
        showOverlay('MẤT KẾT NỐI', 'Kết nối tới server game đã đóng.', 'VỀ TRANG CHỦ', () => { closeSocket(false); showScreen('home'); });
      } else if (screenName !== 'home') {
        setError(screenName === 'lobby' ? 'lobby-error' : 'home-error', 'Kết nối server đã đóng. Hãy quay về trang chủ và kết nối lại.');
      }
    });
  }

  function resetConnectButton() {
    $('online-button').disabled = false;
    $('online-button').classList.remove('is-loading');
    $('online-button').setAttribute('aria-label', 'Tìm phòng online');
  }

  function closeSocket(sendLeave = true) {
    if (ws && ws.readyState === WebSocket.OPEN && sendLeave && activeRoom) sendMessage('CLeaveRoom');
    if (ws) { const old = ws; ws = null; try { old.close(); } catch (_) { } }
    wsReady = false; loggedIn = false; activeRoom = null; isHost = false;
    stopInputSender();
    statusPill('idle', 'SẴN SÀNG KẾT NỐI');
    resetConnectButton();
  }

  // Ghi nhớ ngoại hình (thân/nòng) của từng xe và xe nào đang thật sự di chuyển.
  function rememberSnapshotTanks(snap) {
    const loadouts = {}, motion = {}, positions = {};
    (readField(snap, 'wsTanks') || []).forEach(t => {
      const id = String(readField(t, 'tankId') || '');
      if (!id) return;
      const hull = readField(t, 'tankHull'), gun = readField(t, 'tankGun');
      if (hull && gun) loadouts[id] = { hull: String(hull), gun: String(gun) };
      const pos = readField(t, 'tankPos');
      if (pos) {
        const x = Number(readField(pos, 'vx') || 0), y = Number(readField(pos, 'vy') || 0);
        const before = prevTankPos[id];
        motion[id] = !before || Math.hypot(x - before.x, y - before.y) > .5;
        positions[id] = { x, y };
      }
    });
    tankLoadouts = loadouts; tankMotion = motion; prevTankPos = positions;
  }

  // Server gửi 60 snapshot/giây, nhưng màn hình có thể vẽ nhiều khung hơn (hoặc snapshot
  // đến trễ). Dự đoán vị trí xe và đạn theo vận tốc trong tối đa 2 tick để chuyển động mượt.
  function smoothSnapshot(snap, ageSeconds) {
    const age = Math.max(0, Math.min(.034, ageSeconds));
    if (!snap || age <= 0) return snap;
    const advance = (pos, vel) => {
      if (!pos || !vel) return pos;
      return { ...pos, vx: Number(readField(pos, 'vx') || 0) + Number(readField(vel, 'vx') || 0) * age,
                       vy: Number(readField(pos, 'vy') || 0) + Number(readField(vel, 'vy') || 0) * age };
    };
    const tanks = (readField(snap, 'wsTanks') || []).map(t => {
      if (readField(t, 'tankAlive') === false) return t;
      if (tankMotion[String(readField(t, 'tankId') || '')] === false) return t;
      return { ...t, tankPos: advance(readField(t, 'tankPos'), readField(t, 'tankVel')) };
    });
    const bullets = (readField(snap, 'wsBullets') || []).map(b => ({ ...b, bulPos: advance(readField(b, 'bulPos'), readField(b, 'bulVel')) }));
    return { ...snap, wsTanks: tanks, wsBullets: bullets };
  }

  // Adapter: biến snapshot online thành "game" cùng hình dạng như localGame để các HUD
  // (điểm round, bảng kill, thanh chiếm vùng) và vòng Cấm Địa dùng chung với chế độ offline.
  // Đội của người chơi luôn được đổi thành đội 0 (xanh), giống offline.
  let onlineViewCache = { at: -1, game: null };
  function hudGame() {
    if (mode === 'offline') return localGame;
    if (mode !== 'online' || !latestSnapshot) return null;
    if (onlineViewCache.at === latestSnapshotAt) return onlineViewCache.game;
    const snap = latestSnapshot;
    let game = null;
    if (String(readField(snap, 'wsMode') || 'deathmatch') !== 'deathmatch') {
      const raw = readField(snap, 'wsTanks') || [];
      const meRaw = raw.find(t => isMe(String(readField(t, 'tankId') || '')));
      const flip = !!meRaw && Number(readField(meRaw, 'tankTeam')) === 1;
      const mapTeam = v => (v < 0 ? v : (flip ? 1 - v : v));
      const pair = arr => (Array.isArray(arr) ? (flip ? [Number(arr[1] || 0), Number(arr[0] || 0)] : [Number(arr[0] || 0), Number(arr[1] || 0)]) : [0, 0]);
      const tanks = raw.map(t => ({
        tankId: String(readField(t, 'tankId') || ''), tankAlive: readField(t, 'tankAlive') !== false,
        tankKills: Number(readField(t, 'tankKills') || 0), team: mapTeam(Number(readField(t, 'tankTeam')))
      }));
      const mi = tanks.findIndex(t => isMe(t.tankId));
      if (mi > 0) tanks.unshift(tanks.splice(mi, 1)[0]);
      const zr = readField(snap, 'wsZone');
      const zone = zr ? {
        cx: Number(readField(zr, 'zsCx')), cy: Number(readField(zr, 'zsCy')), radius: Number(readField(zr, 'zsRadius')),
        open: !!readField(zr, 'zsOpen'), lockLeft: Number(readField(zr, 'zsLockLeft')), elapsed: Number(readField(zr, 'zsElapsed')),
        progress: pair(readField(zr, 'zsProgress')), inside: pair(readField(zr, 'zsInside')),
        owner: mapTeam(Number(readField(zr, 'zsOwner'))), overtime: !!readField(zr, 'zsOvertime'),
        hold: Number(readField(zr, 'zsHold')), holdTeam: mapTeam(Number(readField(zr, 'zsHoldTeam'))), orbitRadius: 0
      } : null;
      game = {
        team: true, zone, teamSize: Math.max(1, Math.round(tanks.length / 2)),
        rounds: Number(readField(snap, 'wsRounds') || 1), round: Number(readField(snap, 'wsRound') || 1),
        wins: pair(readField(snap, 'wsTeamWins')), tanks
      };
    }
    onlineViewCache = { at: latestSnapshotAt, game };
    return game;
  }

  function handleServerMessage(msg) {
    const tag = tagOf(msg);
    const data = contentsOf(msg);
    switch (tag) {
      case 'SMatchFound': {
        const payload = data || {};
        const opp = payload.opponent || 'Đối thủ';
        const mapName = payload.map || 'forest';
        if (mmTimerInterval) { clearInterval(mmTimerInterval); mmTimerInterval = null; }
        isMatchmakingSearching = false;
        mode = 'online';
        selectedMapId = mapName;
        localMap = trainingMaps.get(mapName) || trainingMaps.get('forest');
        statusPill('online', `ĐÃ TÌM THẤY TRẬN vs ${opp}!`);
        setText('mm-status-text', `ĐÃ TÌM THẤY TRẬN! vs ${opp}`);
        setText('mm-subtext', `Bản đồ: ${MAP_LABELS[mapName] || mapName.toUpperCase()} • Đang vào trận...`);
        playEndSfx(true, 0.7);
        addFeed(`Tìm thấy đối thủ: ${opp}! Chuẩn bị vào trận...`, 'warn');
        break;
      }
      case 'SMatchmakingStatus': {
        if (data && data.status === 'searching') {
          setText('mm-status-text', `ĐANG TÌM ĐỐI THỦ... (${data.queueCount || 1} trong hàng chờ)`);
        }
        break;
      }

      case 'SLoginSuccess': {
        loggedIn = true;
        const payload = unwrapOne(data);
        if (payload && typeof payload === 'object') {
          username = readField(payload, 'slsUsername') || username;
          displayName = username;
        }
        mode = 'online';
        setError('home-error', '');
        setError('lobby-error', '');
        resetConnectButton();
        statusPill('idle', 'SẴN SÀNG TÌM PHÒNG');
        showScreen('lobby');
        sendMessage('CListRooms');
        addFeed(`Đã đăng nhập: ${displayName}`);
        break;
      }
      case 'SLoginError':
        setError(screenName === 'lobby' ? 'lobby-error' : 'home-error', stringPayload(data) || 'Server từ chối đăng nhập.');
        resetConnectButton();
        break;
      case 'SRoomList':
        roomList = Array.isArray(data) ? data : (Array.isArray(unwrapOne(data)) ? unwrapOne(data) : []);
        renderRoomList();
        break;
      case 'SRoomCreated':
        activeRoom = unwrapOne(data); isHost = true; onRoomReady(); break;
      case 'SRoomJoined':
        activeRoom = unwrapOne(data); isHost = false; onRoomReady(); break;
      case 'SRoomRoster': {
        const list = Array.isArray(data) ? data : (Array.isArray(unwrapOne(data)) ? unwrapOne(data) : []);
        const hostName = readField(activeRoom, 'riHostPlayer') || (roomPlayerNames[0]?.host ? roomPlayerNames[0].name : username);
        roomPlayerNames = list.map(item => {
          const pName = Array.isArray(item) ? item[0] : (item.name || item.username || 'Người chơi');
          const pColor = Array.isArray(item) ? item[1] : (item.color || 'TankBlue');
          return {
            name: pName,
            color: pColor,
            self: pName === username || pName === displayName,
            host: pName === hostName || (isHost && (pName === username || pName === displayName))
          };
        });
        renderRoomPlayers();
        break;
      }
      case 'SRoomDraft': {
        updateOnlineDraft(unwrapOne(data));
        break;
      }
      case 'SDraftOpened': {
        // The host opened the match flow. Every room member chooses a tank
        // before casting a map vote, so no one is sent into a practice game.
        if (activeRoom && screenName === 'room') openTankSelect('onlineMap');
        break;
      }
      case 'SRoomError':
        setError(screenName === 'room' ? 'room-error' : 'lobby-error', stringPayload(data) || 'Thao tác phòng thất bại.');
        break;
      case 'SRoomLeft':
        activeRoom = null; isHost = false; roomPlayerNames = [];
        statusPill('idle', 'SẴN SÀNG TÌM PHÒNG');
        hideOverlay();
        showScreen('lobby'); sendMessage('CListRooms'); addFeed('Bạn đã rời phòng.');
        break;
      case 'SPlayerJoined': {
        const pair = Array.isArray(data) ? data : [];
        const joinedName = pair[0] || 'Người chơi mới';
        if (!roomPlayerNames.some(p => p.name === joinedName)) roomPlayerNames.push({ name: joinedName, color: pair[1] || 'TankBlue', self: false });
        renderRoomPlayers(); addFeed(`${joinedName} đã vào phòng.`); break;
      }
      case 'SPlayerLeft': {
        const gone = stringPayload(data);
        roomPlayerNames = roomPlayerNames.filter(p => p.name !== gone);
        renderRoomPlayers(); addFeed(`${gone || 'Người chơi'} đã rời phòng.`, 'warn'); break;
      }
      case 'SCountdown': {
        const seconds = Number(Array.isArray(data) ? data[0] : data);
        const countdownSecond = Math.max(0, Math.ceil(seconds || 0));
        if (countdownSecond > 0 && lastCountdownSecond === null) startCountdownSound();
        if (countdownSecond === 0) stopCountdownSound();
        lastCountdownSecond = countdownSecond || null;
        if (countdownSecond > 0) {
          updateCountdownOverlay(countdownSecond);
        } else {
          removeCountdownOverlay();
        }
        break;
      }
      case 'SSelectedMap': {
        selectedMapId = String(Array.isArray(data) ? data[0] : data || 'forest');
        localMap = trainingMaps.get(selectedMapId) || trainingMaps.get('forest');
        camera.x = 0;
        camera.y = 0;
        addFeed(`Bản đồ được chọn: ${MAP_LABELS[selectedMapId] || selectedMapId.toUpperCase()}.`);
        break;
      }
      case 'SGameSnapshot': {
        latestSnapshot = unwrapOne(data);
        latestSnapshotAt = performance.now();
        rememberSnapshotTanks(latestSnapshot);
        if (mode === 'online') {
          if (!localMap) localMap = trainingMaps.get(selectedMapId) || trainingMaps.get('forest');
          if (screenName !== 'game') {
            resetMatchUi();
            enterGameplayFullscreen();
            showScreen('game');
          }
          const phase = tagOf(readField(latestSnapshot, 'wsPhase'));
          if (phase === 'CountdownPhase') $('phase-label').textContent = 'CHUẨN BỊ';
          else if (phase === 'InGamePhase') $('phase-label').textContent = 'ĐANG GIAO TRANH';
          else if (phase === 'GameOverPhase' || phase === 'MatchOverPhase') $('phase-label').textContent = 'KẾT THÚC TRẬN';
        }
        trackSnapshot(latestSnapshot);
        break;
      }
      case 'SRoundEnd': {
        const values = Array.isArray(data) ? data : [];
        const winner = values[0] || 'Chưa xác định';
        const scores = Array.isArray(values[1]) ? values[1] : [];
        updateScoreboard({ wsTanks: [], wsScores: scores });
        const myTeam = onlineDraft && onlineDraft.teams && onlineDraft.teams[username];
        const winnerTeam = onlineDraft && onlineDraft.teams && onlineDraft.teams[winner];
        const wonRound = winner === username || (!!myTeam && winnerTeam === myTeam);
        const isDraw = winner === 'Draw';
        const title = isDraw ? 'ROUND DRAW' : wonRound ? 'ROUND WON' : 'DEFEAT';
        const bannerClass = isDraw ? 'round-draw' : wonRound ? 'round-win' : 'round-lose';
        const resultText = isDraw
          ? 'Hiệp đấu hòa. Chuẩn bị sang hiệp tiếp theo.'
          : wonRound ? 'Bạn thắng hiệp này. Hiệp tiếp theo sẽ bắt đầu tự động.'
            : 'Bạn thua hiệp này. Hiệp tiếp theo sẽ bắt đầu tự động.';
        showKillBanner(title, resultText, bannerClass, 'ROUND RESULT', 2500);
        addFeed(isDraw ? 'Hiệp đấu kết thúc với kết quả hòa.' : `${winner} thắng hiệp đấu.`);
        break;
      }
      case 'SGameOver':
      case 'SMatchOver': {
        const values = Array.isArray(data) ? data : [data];
        const winner = values[0] || 'Chưa xác định';
        const scores = Array.isArray(values[1]) ? values[1] : [];
        const mineTank = latestSnapshot ? findMyTank(latestSnapshot) : null;
        const mineStats = mineTank ? tankStats(mineTank) : null;
        const pointBoard = latestSnapshot ? scoreboardEntries(latestSnapshot).map(e => [e.id, e.points]) : [];
        const winTeam = onlineDraft && onlineDraft.teams && onlineDraft.teams[winner];
        const myTeamEnd = onlineDraft && onlineDraft.teams && onlineDraft.teams[username];
        const onlineWon = winner === username || (!!myTeamEnd && winTeam === myTeamEnd);
        playEndSfx(onlineWon, .62);
        showEndSplash(onlineWon ? 'win' : 'lose', () => showPostMatch({
          title: onlineWon ? 'CHIẾN THẮNG' : 'TRẬN ĐẤU KẾT THÚC',
          summary: `${winner} là người chiến thắng chung cuộc.`,
          kills: mineStats ? mineStats.kills : 0, score: mineStats ? mineStats.points : 0,
          map: (localMap && localMap.label) || 'CHIẾN TRƯỜNG',
          scores: pointBoard.length ? pointBoard : scores
        }));
        addFeed(`Chiến thắng chung cuộc: ${winner}`, 'warn'); break;
      }
      case 'SKillEvent': {
        // Current protocol: [killer, victim]. Optional extra fields from a newer backend:
        // [killer, victim, multiKillLevel (1-5 or "DoubleKill"...), shutdown (bool)].
        playSfx('explosion', .38 * SFX_MIX.explosion);
        handleOnlineKillEvent(Array.isArray(data) ? data : []);
        break;
      }
      case 'SMysteryBoxPickup': {
        const pair = Array.isArray(data) ? data : [];
        queueOnlineBoxEffects(String(pair[0] || ''), String(pair[1] || 'NormalBullet'));
        playSfx('pickup', .52);
        addFeed(`${pair[0] || 'Người chơi'} nhặt hộp: ${weaponName(pair[1])}.`); break;
      }
      case 'SLeaderboard':
        addFeed('Đã nhận bảng xếp hạng.'); break;
      case 'SPong': break;
      case 'SError': addFeed(stringPayload(data) || 'Lỗi server.', 'warn'); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- results

  function showPostMatch({ title, kills = 0, score = 0, map = 'FOREST', scores = [], players = null, report = null }) {
    // The match is over: stop and clear every kill notification (banner, voice queue, kill feed).
    resetAnnouncements();
    clearTimeout(bannerTimer);
    ['kill-banner', 'respawn-banner', 'shield-chip'].forEach(id => { const el = $(id); if (el) el.hidden = true; });
    const killFeedEl = $('kill-feed'); if (killFeedEl) killFeedEl.innerHTML = '';
    hideOverlay();
    leaveGameplayFullscreen();
    $('results-title').textContent = title;
    $('results-kills').textContent = String(kills);
    $('results-score').textContent = String(score);
    $('results-map').textContent = String(map).toUpperCase();
    $('results-player-name').textContent = username || displayName || 'TANK PILOT';
    const board = $('results-board');
    board.innerHTML = '';
    const entries = Array.isArray(scores) ? scores.slice().sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0)) : [];
    if (!entries.length) entries.push([username || 'TANK PILOT', score]);
    entries.slice(0, MAX_TEAM_BOTS + 1).forEach(([name, points], index) => {
      const row = document.createElement('div'); row.className = 'results-row';
      const frame = document.createElement('img');
      frame.className = 'results-row-frame';
      frame.alt = '';
      frame.src = index === 0 ? 'assets/menu/hangnhat.png' : 'assets/menu/nguoikhac.png';
      const rank = document.createElement('span'); rank.textContent = String(index + 1).padStart(2, '0');
      const player = document.createElement('span'); player.textContent = name || 'TANK PILOT';
      const value = document.createElement('strong'); value.textContent = `${Number(points || 0)} PTS`;
      row.append(frame, rank, player, value); board.append(row);
    });
    // Offline modes (free-for-all, 2v2, 3v3, 4v4, 5v5) get the detailed LoL / AOV style report.
    const detailed = Array.isArray(players) && players.length > 0;
    const lol = $('results-lol');
    if (lol) { lol.hidden = !detailed; if (detailed) renderMatchReport(lol, players, report || {}); }
    board.hidden = detailed;
    const youPanel = document.querySelector('.results-you-panel'); if (youPanel) youPanel.hidden = detailed;
    const card = document.querySelector('.results-card'); if (card) card.classList.toggle('wide', detailed);
    showScreen('results');
  }

  // Players for the report: { name, team (-1 = free-for-all), kills, deaths, points, me, color }.
  function matchPlayers(g) {
    return g.tanks.map(t => ({ name: t.tankId, team: t.team, kills: t.tankKills, deaths: t.tankDeaths, points: t.tankPoints, me: isMe(t.tankId), color: COLORS[t.tankColor] || '#c7f36b' }));
  }

  // LoL / AOV style report: per-team panels with result banner, MVP / SVP, K/D and score bars.
  function renderMatchReport(root, players, info) {
    root.innerHTML = '';
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    const team = !!info.team, myTeam = info.myTeam ?? 0;
    const maxPoints = Math.max(1, ...players.map(p => p.points));
    const byPoints = list => list.slice().sort((a, b) => b.points - a.points || b.kills - a.kills || a.deaths - b.deaths);
    const outcome = info.outcome || 'draw';
    const groups = team
      ? [myTeam, 1 - myTeam].map(id => ({ id, list: byPoints(players.filter(p => p.team === id)), mine: id === myTeam }))
      : [{ id: -1, list: byPoints(players), mine: true }];
    // MVP: the best score of EACH team in team modes, or of everybody in free-for-all.
    const mvps = new Set(team ? groups.map(gr => gr.list[0]) : [byPoints(players)[0]]);
    if (team && (info.history || []).length) {
      const pips = el('div', 'rl-rounds'); pips.append(el('span', 'rl-rounds-label', 'ROUNDS'));
      info.history.forEach(w => pips.append(el('span', `rl-pip ${w < 0 ? 'draw' : w === myTeam ? 'win' : 'lose'}`)));
      root.append(pips);
    }
    const wrap = el('div', `rl-teams${team ? '' : ' ffa'}`);
    groups.forEach(gr => {
      const cls = !team ? 'ffa' : (gr.mine ? 'blue' : 'red');
      const box = el('section', `rl-team ${cls}`);
      const head = el('div', 'rl-head');
      const name = el('div', 'rl-team-name', !team ? 'LEADERBOARD' : (gr.mine ? 'YOUR TEAM' : 'ENEMY TEAM'));
      if (team) name.append(el('small', '', info.zone ? `${Math.floor(info.zone.progress[gr.id])}% CAPTURED` : `${info.wins ? info.wins[gr.id] : 0} WINS`));
      else { const rank = byPoints(players).findIndex(p => p.me) + 1; name.append(el('small', '', `RANK ${rank}/${players.length}`)); }
      head.append(name);
      if (team) {
        const res = outcome === 'draw' ? 'draw' : (gr.mine === (outcome === 'win') ? 'win' : 'lose');
        head.append(el('div', `rl-result ${res}`, res === 'win' ? 'VICTORY' : res === 'lose' ? 'DEFEAT' : 'DRAW'));
      }
      box.append(head);
      const cols = el('div', 'rl-cols');['', 'NGƯỜI CHƠI', 'K / D', 'ĐIỂM'].forEach(t => cols.append(el('span', '', t)));
      box.append(cols);
      gr.list.forEach((p, i) => {
        const row = el('div', `rl-row${p.me ? ' me' : ''}${i === 0 ? ' first' : ''}`);
        const player = el('div', 'rl-player');
        const nm = el('div', 'rl-name'); const dot = el('span', 'rl-dot'); dot.style.background = p.color;
        nm.append(dot, el('span', '', p.name + (p.me ? ' (BẠN)' : '')));
        if (mvps.has(p)) nm.append(el('span', 'rl-badge', 'MVP'));
        const bar = el('span', 'rl-bar'); const fill = document.createElement('i'); fill.style.width = `${Math.max(3, Math.round(p.points / maxPoints * 100))}%`; bar.append(fill);
        player.append(nm, bar);
        const kd = el('div', 'rl-kd', `${p.kills} / ${p.deaths}`); kd.append(el('small', '', `KDA ${(p.kills / Math.max(1, p.deaths)).toFixed(1)}`));
        row.append(el('span', 'rl-rank', String(i + 1)), player, kd, el('div', 'rl-score', String(p.points)));
        box.append(row);
      });
      wrap.append(box);
    });
    root.append(wrap);
  }

  function exitResultsToHome() {
    setMovementSound(false);
    leaveGameplayFullscreen();
    localGame = null;
    localMap = null;
    if (mode === 'online') closeSocket();
    mode = 'none';
    showScreen('home');
  }

  // From the results screen straight back to where the next match is set up (no trip via the home page):
  // bot mode -> map / difficulty / mode screen, online -> room lobby (leaves the finished room, stays connected).
  function backToBattleRoom() {
    setMovementSound(false);
    leaveGameplayFullscreen();
    const wasOnline = mode === 'online';
    localGame = null;
    localMap = null;
    if (wasOnline && ws && ws.readyState === WebSocket.OPEN && loggedIn) {
      mode = 'none';
      stopInputSender();
      if (activeRoom) { sendMessage('CLeaveRoom'); showScreen('lobby'); }   // SRoomLeft refreshes the room list
      else { showScreen('lobby'); sendMessage('CListRooms'); }
      return;
    }
    if (wasOnline) { exitResultsToHome(); return; }
    openMapSelect();
  }

  // ---------------------------------------------------------------- room / tank select

  function onRoomReady() {
    setError('lobby-error', '');
    statusPill('online', 'ĐÃ VÀO PHÒNG');
    roomPlayerNames = [{ name: username || displayName || 'Bạn', color: isHost ? 'TankRed' : 'TankBlue', self: true, host: isHost }];
    $('room-title').textContent = (readField(activeRoom, 'riRoomName') || 'PHÒNG CHIẾN ĐẤU').toString().toUpperCase();
    const roomMode = readField(activeRoom, 'riGameMode') || 'deathmatch';
    onlineDraft = {
      players: [username || displayName || 'Bạn'],
      maxPlayers: Number(readField(activeRoom, 'riMaxPlayers') || 4),
      mode: roomMode === 'deathmatch' ? 'freeforall' : 'teams',
      votes: {}, teams: {}, stage: 'lobby'
    };
    $('room-code').textContent = readField(activeRoom, 'riRoomId') || '------';
    $('room-caption').textContent = isHost ? 'Bạn là chủ phòng. Chờ bạn bè tham gia.' : 'Bạn đã tham gia phòng. Chờ chủ phòng bắt đầu.';
    $('countdown-banner').hidden = true;
    setError('room-error', '');
    renderRoomPlayers();
    // A room is a waiting area. The host explicitly starts the pre-match
    // flow, then everyone goes tank -> map vote together.
    showScreen('room');
    addFeed(isHost ? 'Đã tạo phòng mới.' : 'Đã tham gia phòng.');
  }

  function refreshTankAssembly() {
    const hull = String(selectedHullId).padStart(2, '0');
    const gun = String(selectedGunId).padStart(2, '0');
    $('tank-preview-hull').src = `assets/tanks/hull_${hull}.png`;
    $('tank-preview-gun').src = `assets/tanks/gun_${gun}.png`;
    $('selected-hull-label').textContent = `THÂN ${hull}`;
    $('selected-gun-label').textContent = `NÒNG ${gun}`;
    document.querySelectorAll('[data-hull]').forEach(button => {
      const active = button.dataset.hull === hull;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-gun]').forEach(button => {
      const active = button.dataset.gun === gun;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function openTankSelect(returnTo) {
    tankSelectReturn = returnTo;
    const savedName = $('player-name').value.trim() || username || displayName || localStorage.getItem('tankwar-name') || '';
    $('tank-name').value = savedName;
    const roomId = activeRoom && readField(activeRoom, 'riRoomId');
    $('tank-select-note').textContent = returnTo === 'offline'
      ? 'Sau khi xác nhận xe, chọn độ khó bot, số bot và map thử. Map online vẫn do server ngẫu nhiên.'
      : returnTo === 'onlineMap'
        ? 'Chọn xe của bạn, rồi bỏ phiếu chọn chiến trường cùng mọi người trong phòng.'
      : roomId
        ? 'Mã phòng đã được cấp. Map và trạng thái trận online vẫn do server quyết định.'
      : 'Sau khi xác nhận, bạn sẽ vào phòng đã chọn.';
    refreshTankAssembly();
    showScreen('tankSelect');
  }

  function closeTankSelect() {
    if (tankSelectReturn === 'room' || tankSelectReturn === 'onlineMap') showScreen('room');
    else showScreen('home');
  }

  function confirmTankSelection() {
    unlockAudio();
    const name = $('tank-name').value.trim() || $('player-name').value.trim() || 'TankPilot';
    username = name;
    displayName = name;
    $('player-name').value = name;
    localStorage.setItem('tankwar-name', name);
    tankLoadoutConfirmed = true;
    if (tankSelectReturn === 'offline') {
      openMapSelect();   // bot difficulty (EASY ... EXTREME), bot count and map are chosen here
      return;
    }
    if (tankSelectReturn === 'connect') {
      // connectOnline keeps the existing WebSocket protocol and reads the
      // name from the (hidden) home field which was just updated above.
      showScreen('home');
      connectOnline();
      return;
    }
    if (tankSelectReturn === 'onlineMap') {
      sendMessage('CSetLoadout', { clsHull: String(selectedHullId).padStart(2, '0'), clsGun: String(selectedGunId).padStart(2, '0') });
      sendMessage('CTankReady');
      openOnlineMapSelect();
      return;
    }
    showScreen('room');
  }

  function renderRoomList() {
    const root = $('room-list');
    if (!roomList.length) {
      root.innerHTML = '<div class="empty-state"><span class="empty-icon">⌁</span><strong>CHƯA CÓ PHÒNG NÀO</strong><small>Tạo phòng mới để bắt đầu.</small></div>';
      return;
    }
    root.innerHTML = '';
    roomList.forEach(room => {
      const id = readField(room, 'riRoomId') || '------';
      const name = readField(room, 'riRoomName') || 'TankWar Room';
      const gameMode = roomModeLabel(readField(room, 'riGameMode'));
      const max = Number(readField(room, 'riMaxPlayers') || 4);
      const current = Number(readField(room, 'riCurrentPlayers') || 0);
      const privateRoom = !!readField(room, 'riHasPassword');
      const phase = tagOf(readField(room, 'riPhase')) || 'LobbyPhase';
      const card = document.createElement('div'); card.className = 'room-card';
      const info = document.createElement('div');
      const h3 = document.createElement('h3'); h3.textContent = name;
      const p = document.createElement('p'); p.textContent = `MÃ ${id} · ${phaseLabel(phase)}`;
      const tags = document.createElement('div'); tags.className = 'room-tags';
      tags.innerHTML = `<span class="tag">${current} / ${max} NGƯỜI</span><span class="tag">${gameMode}</span><span class="tag ${privateRoom ? 'private' : ''}">${privateRoom ? '⌑ RIÊNG TƯ' : '◎ CÔNG KHAI'}</span>`;
      info.append(h3, p, tags);
      const button = document.createElement('button'); button.className = 'join-room-button'; button.type = 'button'; button.textContent = 'THAM GIA →';
      button.disabled = phase !== 'LobbyPhase' || current >= max;
      button.addEventListener('click', () => { $('join-id').value = id; joinRoom(); });
      card.append(info, button); root.append(card);
    });
  }

  function phaseLabel(phase) {
    return ({ LobbyPhase: 'ĐANG CHỜ', CountdownPhase: 'ĐANG ĐẾM NGƯỢC', InGamePhase: 'ĐANG CHƠI', RoundEndPhase: 'CHUẨN BỊ HIỆP TIẾP', MatchOverPhase: 'ĐÃ KẾT THÚC' })[phase] || phase;
  }

  function roomModeLabel(mode) {
    return ({ deathmatch: 'TỬ CHIẾN', team: 'ĐẤU ĐỘI', zone: 'CẤM ĐỊA' })[mode] || 'TỬ CHIẾN';
  }

  function renderRoomPlayers() {
    if (!activeRoom) return;
    const max = Number(readField(activeRoom, 'riMaxPlayers') || 4);
    const current = Number(readField(activeRoom, 'riCurrentPlayers') || roomPlayerNames.length || 1);
    const currentCount = Math.max(current, roomPlayerNames.length);
    $('players-counter').textContent = `${currentCount} / ${max}`;
    $('room-mode-label').textContent = roomModeLabel(readField(activeRoom, 'riGameMode'));
    const root = $('room-players'); root.innerHTML = '';
    const list = [...roomPlayerNames];
    while (list.length < Math.max(1, Math.min(current, max))) list.push({ name: `CHIẾN BINH ${String(list.length + 1).padStart(2, '0')}`, color: ['TankBlue', 'TankGreen', 'TankYellow'][list.length % 3], waiting: true });
    list.forEach(player => {
      const row = document.createElement('div'); row.className = 'player-row';
      const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.style.color = COLORS[player.color] || '#c7f36b'; avatar.textContent = (player.name || '?').slice(0, 1).toUpperCase();
      const titleWrap = document.createElement('div');
      const title = document.createElement('div'); title.className = 'player-name'; title.textContent = player.name;
      const sub = document.createElement('div'); sub.className = 'player-sub'; sub.textContent = player.waiting ? 'ĐÃ KẾT NỐI · ĐANG ĐỒNG BỘ' : player.self ? 'BẠN · ĐÃ KẾT NỐI' : 'ĐÃ KẾT NỐI';
      titleWrap.append(title, sub); row.append(avatar, titleWrap);
      if (player.host || (isHost && player.self)) { const host = document.createElement('span'); host.className = 'host-label'; host.textContent = 'CHỦ PHÒNG'; row.append(host); }
      root.append(row);
    });
    $('start-button').disabled = !isHost || currentCount < 2;
    $('start-button').textContent = !isHost
      ? 'CHỜ CHỦ PHÒNG'
      : currentCount < 2 ? 'CHỜ NGƯỜI CHƠI THỨ 2' : '▶ BẮT ĐẦU TRẬN';
    $('start-button').title = !isHost
      ? 'Chỉ chủ phòng mới bắt đầu được'
      : currentCount < 2 ? 'Cần ít nhất 2 người chơi để bắt đầu' : 'Bắt đầu trận đấu';
  }

  function createRoom() {
    unlockAudio();
    setError('lobby-error', '');
    const roomName = $('room-name').value.trim() || `${displayName || username}’s Arena`;
    syncCustomRoomPlayerOptions();
    const max = Number($('max-players').value || 4);
    const password = $('create-password').value;
    if (!wsReady || !loggedIn) { setError('lobby-error', 'Chưa đăng nhập vào server.'); return; }
    sendMessage('CCreateRoom', { ccrRoomName: roomName, ccrMaxPlayers: max, ccrPassword: password || null, ccrGameMode: $('room-mode').value });
  }

  function syncCustomRoomPlayerOptions() {
    const mode = $('room-mode').value;
    const maxPlayers = $('max-players');
    const evenOnly = mode === 'team' || mode === 'zone';
    Array.from(maxPlayers.options).forEach(option => {
      option.disabled = evenOnly && Number(option.value) % 2 !== 0;
    });
    if (evenOnly && Number(maxPlayers.value) % 2 !== 0) {
      maxPlayers.value = String(Math.min(10, Number(maxPlayers.value) + 1));
    }
  }

  function joinRoom() {
    unlockAudio();
    setError('lobby-error', '');
    const id = $('join-id').value.trim().toUpperCase();
    const password = $('join-password').value;
    if (!/^[A-Z0-9]{6}$/.test(id)) { setError('lobby-error', 'Mã phòng phải có đúng 6 ký tự.'); return; }
    if (!wsReady || !loggedIn) { setError('lobby-error', 'Chưa đăng nhập vào server.'); return; }
    sendMessage('CJoinRoom', { cjrRoomId: id, cjrPassword: password ? password : null });
  }

  // ---------------------------------------------------------------- offline practice

  function openMapSelect() {
    unlockAudio();
    closeSocket(false);
    mode = 'none';
    mapSelectMode = 'offline';
    setOnlineMapUi(false);
    syncOfflineMapChoices();
    setError('map-error', '');
    showScreen('map');
    mapLoadPromise.then(() => {
      if (mapLoadError) setError('map-error', `Không tải được map luyện tập: ${mapLoadError}. Hãy chạy frontend qua http://localhost như hướng dẫn trong web/README.md.`);
    });
  }

  // Practice flow: pick a tank -> pick bot difficulty / bot count / map -> match starts.
  
  // ---------------------------------------------------------------- matchmaking state & flow
  let matchCategory = 'bot'; // 'bot' | 'pvp'
  let mmTimerInterval = null;
  let mmTimerSeconds = 0;
  let isMatchmakingSearching = false;
  let preferredMatchMap = 'random';

  function updateMatchmakingModeDisplay() {
    const isZone = botSettings.zone && botSettings.teamSize >= 2;
    const isTeam = !isZone && botSettings.teamSize >= 2;
    const size = botSettings.teamSize || 2;

    let modeName = 'TỬ CHIẾN';
    let badgeText = 'GHÉP PHÒNG TỬ CHIẾN (1V1)';
    let needed = 2;
    let subtext = 'Hàng chờ 1v1 PvP ngẫu nhiên. Cần 2 người chơi.';

    if (isZone) {
      modeName = `CẤM ĐỊA ${size}V${size}`;
      badgeText = `GHÉP PHÒNG CẤM ĐỊA (${size}V${size})`;
      needed = size * 2;
      subtext = `Hàng chờ Chiếm Cấm Địa ${size}v${size} (Đội Xanh vs Đội Đỏ). Cần ${needed} người chơi.`;
    } else if (isTeam) {
      modeName = `ĐẤU ĐỘI ${size}V${size}`;
      badgeText = `GHÉP PHÒNG ĐẤU ĐỘI (${size}V${size})`;
      needed = size * 2;
      subtext = `Hàng chờ PvP Đấu Đội ${size}v${size} (Đội Xanh vs Đội Đỏ). Cần ${needed} người chơi.`;
    }

    setText('mm-badge-text', badgeText);
    if (!isMatchmakingSearching) {
      setText('mm-subtext', subtext);
      const startBtn = $('mm-start-btn');
      if (startBtn) startBtn.textContent = `⚔️ TÌM TRẬN ${modeName}`;
    }
  }

  function setMatchCategory(cat) {
    matchCategory = cat;
    const isBot = cat === 'bot';
    const label = $('dd-category-label');
    if (label) label.textContent = isBot ? '🤖 ĐẤU BOT' : '⚔️ GHÉP PHÒNG (PVP)';
    document.querySelectorAll('[data-match-category]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.matchCategory === cat);
    });
    const botContainer = $('bot-setup-container');
    if (botContainer) botContainer.hidden = !isBot;
    const mmContainer = $('matchmaking-container');
    if (mmContainer) mmContainer.hidden = isBot;

    const title = $('map-settings-title');
    const subtitle = $('map-settings-subtitle');
    if (isBot) {
      if (title) title.textContent = 'THIẾT LẬP TRẬN';
      if (subtitle) subtitle.textContent = 'Chọn thông số trước khi vào trận.';
      cancelMatchmaking();
    } else {
      if (title) title.textContent = 'GHÉP PHÒNG PVP';
      if (subtitle) subtitle.textContent = 'Chọn chế độ bên dưới và ghép trận ngẫu nhiên.';
    }
    updateMatchmakingModeDisplay();
    syncOfflineMapChoices();
  }

  function startMatchmaking(preferredMap) {
    unlockAudio();
    // Server hiện chưa hỗ trợ ghép trận tự động (CStartMatchmaking không tồn tại
    // trong Common.Protocol). Báo rõ thay vì quay vòng mãi mãi.
    setError('map-error', 'Ghép trận tự động chưa được server hỗ trợ. Hãy dùng ĐĂNG NHẬP ONLINE rồi tạo/vào phòng.');
    cancelMatchmaking();
    return;
  }

  function startMatchmakingUnsupported(preferredMap) {
    const isZone = botSettings.zone && botSettings.teamSize >= 2;
    const isTeam = !isZone && botSettings.teamSize >= 2;
    const size = botSettings.teamSize || 0;
    const modeTag = isZone ? 'zone' : (isTeam ? 'team' : 'deathmatch');
    const actualMap = isZone ? 'camdia' : (preferredMap || preferredMatchMap || 'random');
    preferredMatchMap = actualMap;

    isMatchmakingSearching = true;

    const radar = $('mm-radar');
    if (radar) radar.classList.add('searching');
    setText('mm-status-text', 'ĐANG TÌM ĐỐI THỦ...');
    const modeDesc = isZone ? `Cấm Địa ${size}v${size}` : (isTeam ? `Đấu Đội ${size}v${size}` : 'Tử Chiến 1v1');
    setText('mm-subtext', `Chế độ: ${modeDesc} • Bản đồ: ${MAP_LABELS[actualMap] || actualMap.toUpperCase()}`);
    const timerEl = $('mm-timer');
    if (timerEl) {
      timerEl.hidden = false;
      timerEl.textContent = '00:00';
    }
    if ($('mm-start-btn')) $('mm-start-btn').hidden = true;
    if ($('mm-cancel-btn')) $('mm-cancel-btn').hidden = false;

    mmTimerSeconds = 0;
    if (mmTimerInterval) clearInterval(mmTimerInterval);
    mmTimerInterval = setInterval(() => {
      mmTimerSeconds++;
      const m = String(Math.floor(mmTimerSeconds / 60)).padStart(2, '0');
      const s = String(mmTimerSeconds % 60).padStart(2, '0');
      if (timerEl) timerEl.textContent = `${m}:${s}`;
    }, 1000);

    statusPill('online', 'ĐANG TÌM TRẬN...');
    playSfx('bonus');

    ensureMatchmakingSocket(() => {
      sendMessage('CStartMatchmaking', {
        name: username || displayName || $('tank-name').value.trim() || 'TankPilot',
        mode: modeTag,
        teamSize: size,
        preferredMap: actualMap,
        hull: selectedHullId,
        gun: selectedGunId
      });
    });
  }

  function cancelMatchmaking() {
    isMatchmakingSearching = false;
    if (mmTimerInterval) {
      clearInterval(mmTimerInterval);
      mmTimerInterval = null;
    }
    const radar = $('mm-radar');
    if (radar) radar.classList.remove('searching');
    setText('mm-status-text', 'SẴN SÀNG TÌM ĐỐI THỦ');
    updateMatchmakingModeDisplay();
    if ($('mm-timer')) $('mm-timer').hidden = true;
    if ($('mm-start-btn')) $('mm-start-btn').hidden = false;
    if ($('mm-cancel-btn')) $('mm-cancel-btn').hidden = true;

    statusPill('idle', 'SẴN SÀNG KẾT NỐI');

    if (ws && ws.readyState === WebSocket.OPEN) {
      sendMessage('CCancelMatchmaking');
    }
  }

  function ensureMatchmakingSocket(onReady) {
    const url = $('server-url').value.trim() || defaultWsUrl;
    const name = username || displayName || $('tank-name').value.trim() || 'TankPilot';
    username = name;
    displayName = name;

    if (ws && ws.readyState === WebSocket.OPEN) {
      onReady();
      return;
    }

    closeSocket(false);
    try {
      const socket = new WebSocket(url);
      ws = socket;
      socket.onopen = () => {
        wsReady = true;
        statusPill('online', 'ĐÃ KẾT NỐI SERVER');
        sendMessage('CLogin', { clUsername: name, clDisplayName: name });
        onReady();
      };
      socket.onmessage = e => { try { handleServerMessage(JSON.parse(e.data)); } catch (_) { handleServerMessage(e.data); } };
      socket.onerror = err => {
        console.warn('Matchmaking WS error:', err);
        cancelMatchmaking();
        setError('map-error', 'Không thể kết nối server game. Hãy kiểm tra server WebSocket!');
      };
      socket.onclose = () => {
        wsReady = false;
        if (mode === 'online') {
          statusPill('offline', 'MẤT KẾT NỐI');
        }
      };
    } catch (err) {
      cancelMatchmaking();
      setError('map-error', `Lỗi kết nối WebSocket: ${err.message}`);
    }
  }

function chooseOfflineMap(mapId) {
    unlockAudio();
    if (matchCategory === 'pvp') {
      preferredMatchMap = mapId;
      document.querySelectorAll('[data-map]').forEach(btn => btn.classList.toggle('active', btn.dataset.map === mapId));
      startMatchmaking(mapId);
      return;
    }
    const isControlZone = botSettings.zone && botSettings.teamSize >= 2;
    // Cấm Địa has exactly one available map.  Never accept a stale click on a
    // hidden Forest/Ruins/Depot/Random card after its mode has been changed.
    if (isControlZone && mapId !== 'camdia') return;
    const chosen = isControlZone ? 'camdia' : mapId;
    selectedMapId = chosen;
    startOffline(chosen);
  }

  function syncOfflineMapChoices() {
    const isControlZone = botSettings.zone && botSettings.teamSize >= 2;
    document.querySelectorAll('[data-map]').forEach(button => {
      if (button.dataset.map === 'random') {
        button.hidden = isControlZone;
        return;
      }
      button.hidden = isControlZone ? button.dataset.map !== 'camdia' : button.dataset.map === 'camdia';
    });
    const heading = document.querySelector('.map-picker-heading');
    if (mapSelectMode === 'offline' && heading) {
      heading.textContent = isControlZone ? 'CHỌN CẤM ĐỊA' : (matchCategory === 'pvp' ? 'CHỌN BẢN ĐỒ PVP' : 'CHỌN CHIẾN TRƯỜNG');
    }
  }

  // ---------------------------------------------------------------- online map vote

  const MAP_LABELS = { forest: 'FOREST', ruins: 'RUINS', depot: 'DEPOT', random: 'NGẪU NHIÊN' };

  function updateOnlineDraft(payload) {
    const draft = payload && typeof payload === 'object' ? payload : {};
    const players = Array.isArray(draft.players) ? draft.players : [];
    onlineDraft = {
      players: players.map(player => typeof player === 'string' ? player : (player.username || player.name || 'Người chơi')),
      maxPlayers: Math.max(2, Number(draft.maxPlayers || onlineDraft.maxPlayers || 4)),
      // A public room is always split into the two visible sides.  The
      // number of slots scales with its capacity (five slots per side for a
      // 10-player room), so players never have to toggle an unexplained
      // "5V5" switch before picking a side.
      mode: draft.mode === 'teams' ? 'teams' : 'freeforall',
      votes: draft.votes && typeof draft.votes === 'object' ? draft.votes : {},
      teams: draft.teams && typeof draft.teams === 'object' ? draft.teams : {},
      stage: draft.stage || 'lobby'
    };
    if (mapSelectMode === 'online') renderOnlineMatchSetup();
  }

  function setOnlineMapUi(online) {
    const mapScreen = $('map-screen');
    mapScreen.classList.toggle('online-map-mode', online);
    $('match-setup').hidden = online;
    $('online-match-setup').hidden = !online;
    if (online) {
      const teamMode = onlineDraft.mode === 'teams';
      setText('map-settings-title', teamMode ? 'CHỌN PHE' : 'BỎ PHIẾU BẢN ĐỒ');
      setText('map-settings-subtitle', teamMode ? 'Chọn phe và xem phiếu của cả phòng.' : 'Bỏ phiếu bản đồ cùng mọi người trong phòng.');
      document.querySelectorAll('[data-map]').forEach(button => {
        button.hidden = button.dataset.map === 'camdia';
        button.classList.toggle('active', onlineDraft.votes[username] === button.dataset.map);
      });
      const heading = document.querySelector('.map-picker-heading');
      if (heading) heading.textContent = 'BỎ PHIẾU CHIẾN TRƯỜNG';
    } else {
      setMatchCategory(matchCategory || 'bot');
    }
  }

  function openOnlineMapSelect() {
    unlockAudio();
    if (!wsReady || !activeRoom) { showScreen('room'); return; }
    mode = 'online';
    mapSelectMode = 'online';
    setError('map-error', '');
    setOnlineMapUi(true);
    renderOnlineMatchSetup();
    showScreen('map');
  }

  function chooseOnlineMap(mapId) {
    if (!activeRoom || !wsReady) return;
    selectedMapId = mapId;
    onlineDraft.votes = { ...onlineDraft.votes, [username]: mapId };
    setOnlineMapUi(true);
    renderOnlineMatchSetup();
    sendMessage('CMapVote', { cmvMapId: mapId });
  }

  function getOnlineDraftReadiness(players) {
    const activePlayers = players.filter(Boolean);
    const missing = activePlayers.filter(player => {
      const voted = Object.prototype.hasOwnProperty.call(onlineDraft.votes, player);
      const choseTeam = onlineDraft.teams[player] === 'blue' || onlineDraft.teams[player] === 'red';
      return !voted || (onlineDraft.mode === 'teams' && !choseTeam);
    });
    return { ready: activePlayers.length >= 2 && missing.length === 0, missing, playerCount: activePlayers.length };
  }

  function renderOnlineMatchSetup() {
    const players = onlineDraft.players.length
      ? onlineDraft.players
      : roomPlayerNames.map(player => player.name).filter(Boolean);
    const votes = $('online-player-votes');
    if (!votes) return;
    votes.innerHTML = '';
    const slotCount = Math.max(players.length, Math.min(10, onlineDraft.maxPlayers || 2));
    for (let index = 0; index < slotCount; index += 1) {
      const player = players[index] || '';
      const vote = player ? onlineDraft.votes[player] : '';
      const row = document.createElement('div');
      row.className = `online-player-vote${player === username ? ' self' : ''}${!player ? ' waiting' : ''}`;
      row.innerHTML = `<b>${String(index + 1).padStart(2, '0')}</b><span>${player || 'ĐANG CHỜ'}</span><small>${vote ? MAP_LABELS[vote] : 'CHƯA CHỌN'}</small>`;
      votes.append(row);
    }
    const teamPicker = $('online-team-picker');
    teamPicker.hidden = onlineDraft.mode !== 'teams';
    renderOnlineTeamRow('online-team-blue', 'blue', players);
    renderOnlineTeamRow('online-team-red', 'red', players);
    const readiness = getOnlineDraftReadiness(players);
    const counts = { forest: 0, ruins: 0, depot: 0, random: 0 };
    Object.values(onlineDraft.votes).forEach(vote => { if (Object.prototype.hasOwnProperty.call(counts, vote)) counts[vote] += 1; });
    const choices = Object.entries(counts).filter(([, count]) => count > 0);
    let leader = readiness.playerCount < 2
      ? 'CẦN ÍT NHẤT 2 NGƯỜI CHƠI ĐỂ BẮT ĐẦU'
      : 'CÁC NGƯỜI CHƠI CHƯA SẴN SÀNG';
    if (readiness.ready && choices.length) {
      const max = Math.max(...choices.map(([, count]) => count));
      const leaders = choices.filter(([, count]) => count === max).map(([map]) => MAP_LABELS[map]);
      leader = leaders.length > 1 ? `ĐỒNG PHIẾU: ${leaders.join(' / ')}` : `TẠM DẪN: ${leaders[0]} · ${max} PHIẾU`;
    }
    setText('online-vote-summary', leader);
    const start = $('online-start-match');
    start.hidden = !isHost;
    start.disabled = !isHost || !readiness.ready || choices.length === 0;
    start.textContent = readiness.playerCount < 2 ? 'CẦN 2 NGƯỜI CHƠI' : '▶ CHỐT BẢN ĐỒ & BẮT ĐẦU';
  }

  function renderOnlineTeamRow(id, team, players) {
    const row = $(id);
    const teamCapacity = Math.max(1, Math.min(5, Math.ceil((onlineDraft.maxPlayers || 2) / 2)));
    const members = players.filter(player => onlineDraft.teams[player] === team).slice(0, teamCapacity);
    row.classList.toggle('selected', onlineDraft.teams[username] === team);
    const slots = Array.from({ length: teamCapacity }, (_, index) => `<i class="${members[index] ? 'occupied' : ''}" title="${members[index] || 'Trống'}">${members[index] ? members[index].slice(0, 1).toUpperCase() : ''}</i>`).join('');
    row.querySelector('.team-slots').innerHTML = slots;
  }

  async function startOffline(mapId = TEST_GAME.defaultMapId || 'forest') {
    unlockAudio();
    enterGameplayFullscreen();
    await mapLoadPromise;
    const chosenMap = trainingMaps.get(mapId);
    if (!chosenMap) {
      leaveGameplayFullscreen();
      showScreen('map');
      setError('map-error', `Không thể khởi tạo map ${String(mapId).toUpperCase()}. ${mapLoadError || 'Kiểm tra static server.'}`);
      return;
    }
    hideOverlay();
    hidePauseModal();
    closeSocket(false);
    mode = 'offline'; activeRoom = null; isHost = false;
    selectedMapId = mapId;
    localMap = chosenMap;
    localGame = createLocalGame(username || 'TankPilot');
    latestSnapshot = localSnapshot();
    resetMatchUi();
    const teamLabel = localGame.team ? `${localGame.teamSize}V${localGame.teamSize} · ` : '';
    $('match-mode').textContent = `OFFLINE · ${teamLabel}${BOT_LEVELS[botSettings.difficulty].label}`;
    $('match-room').textContent = chosenMap.label;
    $('phase-label').textContent = localGame.zone ? 'CẤM ĐỊA · CHIẾM VÙNG' : localGame.team ? `TỬ CHIẾN ĐỒNG ĐỘI · ${localGame.rounds} ROUND` : 'ĐANG THỰC HÀNH';
    $('match-player-count').textContent = String(localGame.tanks.length);
    setError('home-error', '');
    statusPill('idle', 'CHẾ ĐỘ OFFLINE');
    updateMatchHeader(latestSnapshot); updateScoreboard(latestSnapshot); updateWeaponPanel(latestSnapshot);
    showScreen('game');
    addFeed(`Bắt đầu thực hành tại ${chosenMap.label}.`);
  }

  function getLocalSpawns(map) {
    const preferred = (map.spawns || []).map(point => ({ ...point }));
    const fallbacks = [
      { vx: map.width - 288, vy: 288 }, { vx: 288, vy: map.height - 288 },
      { vx: map.width - 288, vy: map.height - 288 }
    ];
    return preferred.concat(fallbacks).filter((point, index, points) =>
      !points.slice(0, index).some(other => other.vx === point.vx && other.vy === point.vy)
    ).slice(0, 4);
  }

  function createLocalGame(name) {
    const teamSize = botSettings.teamSize >= 2 ? Math.min(5, botSettings.teamSize) : 0;
    const team = teamSize >= 2;
    // Team mode: you + (teamSize - 1) allies against teamSize enemies. Tank 0 is you, then allies, then enemies.
    const botCount = team ? teamSize * 2 - 1 : Math.max(1, Math.min(MAX_BOTS, botSettings.bots));
    const colors = [selectedTankColor].concat(['TankRed', 'TankBlue', 'TankGreen', 'TankYellow'].filter(color => color !== selectedTankColor));
    const teamOf = i => team ? (i < teamSize ? 0 : 1) : -1;
    const teamColor = i => teamOf(i) === 0 ? 'TankBlue' : 'TankRed';
    const configuredNames = Array.from(TEST_GAME.localBotNames || []);
    const names = [name].concat(Array.from({ length: botCount }, (_, i) => configuredNames[i] || `CPU-${i + 1}`));
    const spawns = team ? teamBaseSpawns(teamSize) : localSpawnPoints(names.length);
    const tanks = names.map((n, i) => ({
      tankId: n,
      tankPos: { ...spawns[i] }, tankVel: { vx: 0, vy: 0 }, tankBodyAngle: 0,
      tankTurretAngle: Math.PI, tankColor: team ? teamColor(i) : colors[i % colors.length], team: teamOf(i),
      tankWeapon: { wsCurrentWeapon: 'NormalBullet', wsBuffTimeLeft: 0, wsCooldownState: 'Ready' },
      tankAlive: true, tankScore: 0, tankKills: 0, tankDeaths: 0, tankAssists: 0, tankPoints: 0,
      tankKillStreak: 0, tankRespawnTimer: 0, tankInvulnerabilityLeft: 0,
      tankAmmo: RULES.magazineSize, tankMaxAmmo: RULES.magazineSize, tankReloadTimer: 0,
      _spawn: { ...spawns[i] }, _survival: 0, _powerBuff: 0, _multi: { count: 0, last: -999 },
      _bot: i > 0, _role: Math.random() < .7 ? 'cap' : 'flank', _cooldown: .8 + i * .45, _dirTimer: 0, _direction: Math.random() * Math.PI * 2,
      _prev: { ...spawns[i] }, _v: { vx: 0, vy: 0 }, _think: Math.random() * .3, _path: [], _wp: null, _pathAge: 99, _roam: null,
      _sees: false, _seen: 0, _strafe: Math.random() < .5 ? 1 : -1, _strafeT: 0, _dodge: null, _dodgeT: 0, _dodgeCheck: 0
    }));
    const view = localViewSize();
    camera.x = clamp(spawns[0].vx - view.width / 2, 0, localMap.width - view.width);
    camera.y = clamp(spawns[0].vy - view.height / 2, 0, localMap.height - view.height);
    return {
      name, tanks, bullets: [], boxes: [], effects: [], heartSequence: null, lasers: [], time: 0, boxTimer: 10, startCountdown: 5,
      fireCooldown: 0, gameOver: false, spectatorTankId: '', difficulty: botSettings.difficulty,
      // Team mode state: best-of rounds, every round a death match without respawn.
      team, teamSize, rounds: botSettings.teamRounds, round: 1, wins: [0, 0], roundClock: 0,
      roundOver: false, roundEndTimer: 0, awaitingNext: false, roundResult: null, history: [], teamSeen: [null, null],
      // Control zone state (Cấm Địa): one capture zone in the middle of the map, locked for the first seconds.
      zone: team && botSettings.zone ? {
        // The capture point orbits in the central clearing. Moving it makes
        // a fixed defensive setup unsustainable while keeping it reachable.
        anchorX: localMap.width / 2, anchorY: localMap.height / 2,
        cx: localMap.width / 2, cy: localMap.height / 2,
        radius: localMap.id === 'camdia' ? 620 : RULES.zoneRadius,
        orbitRadius: localMap.id === 'camdia' ? 560 : 0,
        orbitAngle: -Math.PI / 2, orbitPeriod: 52,
        lockLeft: RULES.zoneLockSeconds, open: false, owner: -1, progress: [0, 0], inside: [0, 0],
        overtime: false, hold: 0, holdTeam: -1, shown70: [false, false],
        elapsed: 0, openVoiceDone: false, rateVoiceDone: false   // elapsed = zone clock (starts at 00:00 when the zone opens)
      } : null
    };
  }

  // ---- Control zone map: the same maze, slightly bigger, with the capture zone in the middle ----
  function makeZoneMap(base) {
    const k = RULES.zoneMapScale;
    const width = base.width * k, height = base.height * k;
    const scale = rects => rects.map(r => ({ ...r, x: r.x * k, y: r.y * k, width: r.width * k, height: r.height * k }));
    const wallRects = scale(base.wallRects), blockedRects = scale(base.blockedRects);
    return {
      ...base, width, height, cellSize: base.cellSize * k, gridOffset: base.gridOffset * k, wallThickness: base.wallThickness * k,
      wallRects, blockedRects, collisionRects: wallRects.concat(blockedRects),
      spawns: (base.spawns || []).map(p => ({ vx: p.vx * k, vy: p.vy * k })),
      baseWidth: base.width, baseCellSize: base.cellSize, baseGridOffset: base.gridOffset, zoneScale: k,
      _nav: null
    };
  }

  // Team mode spawns (like a MOBA base): each team starts packed together in its own corner of the map,
  // the two bases being at opposite ends. Tank 0 (you) is first, then your allies, then the enemy team.
  function teamBaseSpawns(size) {
    const points = getLocalSpawns(localMap);
    // Every match your team starts in a random corner; the enemy team takes the diagonally opposite one
    // (the farthest spawn point). The sides stay the same for all rounds of that match.
    const baseA = points[Math.floor(Math.random() * points.length)] || points[0];
    const baseB = points.reduce((far, p) => distance(p, baseA) > distance(far, baseA) ? p : far, points.find(p => p !== baseA) || baseA);
    return clusterSpawns(baseA, size).concat(clusterSpawns(baseB, size));
  }

  // `count` open, well-spaced points around an anchor (the anchor itself first).
  function clusterSpawns(anchor, count) {
    const step = 170, offsets = [];
    for (let ix = -3; ix <= 3; ix++) for (let iy = -3; iy <= 3; iy++) offsets.push({ vx: ix * step, vy: iy * step });
    offsets.sort((p, q) => Math.hypot(p.vx, p.vy) - Math.hypot(q.vx, q.vy));
    const picked = [];
    offsets.forEach(o => {
      if (picked.length >= count) return;
      const pos = { vx: anchor.vx + o.vx, vy: anchor.vy + o.vy };
      if (pos.vx < 120 || pos.vy < 120 || pos.vx > localMap.width - 120 || pos.vy > localMap.height - 120) return;
      if (collidesLocalMap(pos, LOCAL_TANK_RADIUS + 10)) return;
      picked.push(pos);
    });
    while (picked.length < count) picked.push({ ...anchor });   // very cramped map: stack on the anchor
    return picked;
  }

  // The snapshot exposes the same Tank fields the Haskell server sends, so the HUD code is shared.
  function publicTank(t) {
    return {
      tankId: t.tankId, tankPos: t.tankPos, tankVel: t.tankVel, tankBodyAngle: t.tankBodyAngle, tankTurretAngle: t.tankTurretAngle,
      tankColor: t.tankColor, tankWeapon: t.tankWeapon, tankAlive: t.tankAlive, tankScore: t.tankScore,
      tankKills: t.tankKills, tankDeaths: t.tankDeaths, tankAssists: t.tankAssists, tankPoints: t.tankPoints,
      tankKillStreak: t.tankKillStreak, tankRespawnTimer: t.tankRespawnTimer, tankInvulnerabilityLeft: t.tankInvulnerabilityLeft, tankTeam: t.team,
      tankAmmo: t.tankAmmo, tankMaxAmmo: t.tankMaxAmmo, tankReloadTimer: t.tankReloadTimer
    };
  }

  function localSnapshot() {
    if (!localGame) return null;
    return {
      wsTanks: localGame.tanks.map(publicTank),
      wsBullets: localGame.bullets.map(b => ({ bulPos: b.pos, bulVel: b.vel, bulType: b.type, bulOwnerId: b.owner, bulBounces: b.bounces, bulLifetime: b.life })),
      wsLasers: localGame.lasers,
      wsMysteryBoxes: localGame.boxes.map(b => ({ mbPos: b.pos, mbActive: true, mbRespawnIn: 0, mbSpawnedAt: b.spawnedAt })),
      wsMaze: maze,
      wsPhase: localGame.gameOver ? { tag: 'MatchOverPhase', contents: localGame.name } : { tag: 'InGamePhase' },
      wsScores: localGame.tanks.map(t => [t.tankId, t.tankPoints])
    };
  }

  function localSpawnPoints(count) {
    const points = getLocalSpawns(localMap);
    while (points.length < count) {
      let chosen = null;
      for (let attempt = 0; attempt < 120 && !chosen; attempt++) {
        const candidate = pickOpenLocalPoint(LOCAL_TANK_RADIUS + 10);
        if (points.every(other => distance(other, candidate) > 1400)) chosen = candidate;
      }
      points.push(chosen || pickOpenLocalPoint(LOCAL_TANK_RADIUS + 10));
    }
    return points;
  }

  // ---- bot navigation: a 64 px walkability grid per map, solved with breadth-first search ----
  const NAV_STEP = 64;

  function navGrid() {
    if (localMap._nav) return localMap._nav;
    const cols = Math.ceil(localMap.width / NAV_STEP), rows = Math.ceil(localMap.height / NAV_STEP);
    const open = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        open[r * cols + c] = collidesLocalMap({ vx: (c + .5) * NAV_STEP, vy: (r + .5) * NAV_STEP }, LOCAL_TANK_RADIUS + 6) ? 0 : 1;
      }
    }
    localMap._nav = { cols, rows, open };
    return localMap._nav;
  }

  function nearestOpenCell(nav, index) {
    if (nav.open[index]) return index;
    const cx = index % nav.cols, cy = (index / nav.cols) | 0;
    for (let radius = 1; radius <= 6; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && y >= 0 && x < nav.cols && y < nav.rows && nav.open[y * nav.cols + x]) return y * nav.cols + x;
        }
      }
    }
    return -1;
  }

  function navPath(from, to) {
    const nav = navGrid(), { cols, rows, open } = nav;
    const toIndex = p => clamp(Math.floor(p.vy / NAV_STEP), 0, rows - 1) * cols + clamp(Math.floor(p.vx / NAV_STEP), 0, cols - 1);
    const start = toIndex(from), goal = nearestOpenCell(nav, toIndex(to));
    if (goal < 0) return [];
    const prev = new Int32Array(cols * rows).fill(-1), queue = new Int32Array(cols * rows);
    let head = 0, tail = 0;
    queue[tail++] = start; prev[start] = start;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (head < tail) {
      const cur = queue[head++];
      if (cur === goal) break;
      const cx = cur % cols, cy = (cur / cols) | 0;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const next = ny * cols + nx;
        if (prev[next] !== -1 || !open[next]) continue;
        if (dx && dy && (!open[cy * cols + nx] || !open[ny * cols + cx])) continue;
        prev[next] = cur; queue[tail++] = next;
      }
    }
    if (prev[goal] === -1) return [];
    const path = [];
    for (let cur = goal; cur !== start; cur = prev[cur]) path.push({ vx: ((cur % cols) + .5) * NAV_STEP, vy: (((cur / cols) | 0) + .5) * NAV_STEP });
    return path.reverse();
  }

  function lineClear(a, b, radius) {
    const steps = Math.max(1, Math.ceil(distance(a, b) / 40));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (collidesLocalMap({ vx: a.vx + (b.vx - a.vx) * t, vy: a.vy + (b.vy - a.vy) * t }, radius)) return false;
    }
    return true;
  }

  // Skip ahead along the path to the farthest waypoint that can be reached in a straight line.
  function pickWaypoint(bot) {
    const path = bot._path;
    while (path.length > 1 && distance(bot.tankPos, path[0]) < NAV_STEP * .8) path.shift();
    for (let i = Math.min(path.length - 1, 7); i > 0; i--) {
      if (lineClear(bot.tankPos, path[i], LOCAL_TANK_RADIUS)) return path[i];
    }
    return path[0] || null;
  }

  function turnToward(current, wanted, maxStep) {
    const diff = Math.atan2(Math.sin(wanted - current), Math.cos(wanted - current));
    return current + clamp(diff, -maxStep, maxStep);
  }

  function angleGap(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

  function botHeading(bot, dest, lvl) {
    let point = dest;
    if (lvl.path && bot._wp) {
      point = bot._wp;
      if (distance(bot.tankPos, point) < 50) bot._think = 0;
    } else if (!lvl.path && bot._dirTimer > 0) {
      return { x: Math.cos(bot._direction), y: Math.sin(bot._direction) };
    }
    const dx = point.vx - bot.tankPos.vx, dy = point.vy - bot.tankPos.vy, len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  // One bot, one frame: pick a target, plan a route, dodge, move, aim (with lead) and shoot.
  function updateLocalBot(bot, dt) {
    const g = localGame, level = BOT_LEVELS[g.difficulty] || BOT_LEVELS.medium, player = g.tanks[0];
    const lvl = g.zone && !level.path ? { ...level, path: true } : level;   // control zone: even EASY bots find their way around walls to the zone
    bot._cooldown -= dt; bot._think -= dt; bot._strafeT -= dt; bot._dodgeT -= dt; bot._dodgeCheck -= dt; bot._dirTimer -= dt; bot._pathAge += dt;
    const range = visionRadius() * lvl.range;

    // 1. Perception: a bot only reacts to an enemy it has actually spotted (inside its vision range and, on the
    // smarter levels, with a clear line of sight). It no longer knows where everybody is, so it stops rushing the centre.
    let target = null, best = Infinity;
    if (bot._targetId) {
      const known = g.tanks.find(t => t.tankId === bot._targetId && t.tankAlive);
      if (known) { target = known; best = distance(bot.tankPos, known.tankPos); } else bot._targetId = null;
    }

    // 2. Re-plan a few times per second.
    if (bot._think <= 0) {
      bot._think = lvl.think * (.8 + Math.random() * .4);
      let cand = null, candDist = Infinity, bestWeighted = Infinity;
      g.tanks.filter(t => t !== bot && t.tankAlive && (!g.team || t.team !== bot.team)).forEach(t => {
        const d = distance(bot.tankPos, t.tankPos);
        // Only enemies that are really spotted count (in range, clear line of sight on smarter levels), so an enemy
        // hidden behind a wall no longer hides the others.
        if (d > range || (lvl.los && !lineClear(bot.tankPos, t.tankPos, 12))) return;
        // The human is only slightly preferred: their distance counts as 15% shorter.
        const weighted = t === player ? d * .85 : d;
        if (weighted < bestWeighted) { bestWeighted = weighted; candDist = d; cand = t; }
      });
      bot._sees = !!cand;
      if (bot._sees) {
        target = cand; best = candDist; bot._targetId = cand.tankId;
        bot._lastSeen = { pos: { ...cand.tankPos }, t: g.time };
        if (g.team && lvl.path) g.teamSeen[bot.team] = { pos: { ...cand.tankPos }, t: g.time };   // teammates get the callout
      } else { target = null; best = Infinity; bot._targetId = null; }
      bot._dest = botDestination(bot, lvl, target);
      if (lvl.path && bot._dest) {
        bot._path = navPath(bot.tankPos, bot._dest);
        bot._wp = pickWaypoint(bot);
        if (!bot._path.length && !bot._sees) { bot._roam = null; bot._roamUntil = 0; }   // unreachable / already there: pick another patrol point
      }
    }

    // Re-validate the sighting every few frames so a bot never keeps shooting at a target that went out of range
    // or behind a wall since the last re-plan.
    bot._losCheck = (bot._losCheck || 0) - dt;
    if (target && bot._sees && bot._losCheck <= 0) {
      bot._losCheck = .07;
      best = distance(bot.tankPos, target.tankPos);
      if (best > range * 1.1 || (lvl.los && !lineClear(bot.tankPos, target.tankPos, 12))) { bot._sees = false; bot._think = Math.min(bot._think, .05); }
    }

    // 3. Dodge: look for a bullet whose path passes through this tank within the next ~0.9 s.
    if (lvl.dodge > 0 && bot._dodgeCheck <= 0 && bot._dodgeT <= 0) {
      bot._dodgeCheck = .08;
      for (const b of g.bullets) {
        if (b.owner === bot.tankId || b.life <= 0) continue;
        if (g.team && (g.tanks.find(t => t.tankId === b.owner) || {}).team === bot.team) continue;   // ally bullets are harmless
        const rx = bot.tankPos.vx - b.pos.vx, ry = bot.tankPos.vy - b.pos.vy;
        const speed2 = b.vel.vx * b.vel.vx + b.vel.vy * b.vel.vy;
        const t = (rx * b.vel.vx + ry * b.vel.vy) / speed2;
        if (t <= 0 || t > .9) continue;
        const cx = b.pos.vx + b.vel.vx * t - bot.tankPos.vx, cy = b.pos.vy + b.vel.vy * t - bot.tankPos.vy;
        if (Math.hypot(cx, cy) > LOCAL_TANK_RADIUS + 20 || Math.random() > lvl.dodge) continue;
        const speed = Math.sqrt(speed2);
        let px = -b.vel.vy / speed, py = b.vel.vx / speed;
        if (px * cx + py * cy > 0) { px = -px; py = -py; }   // sidestep away from the point of impact
        bot._dodge = { x: px, y: py }; bot._dodgeT = .35;
        break;
      }
    }

    // 4. Movement.
    let dir = null;
    bot._escapeT = (bot._escapeT || 0) - dt;
    if (bot._escapeT > 0) dir = { x: Math.cos(bot._direction), y: Math.sin(bot._direction) };
    else if (bot._dodgeT > 0 && bot._dodge) dir = bot._dodge;
    else if (target && lvl.strafe && bot._sees) {
      const preferred = range * .55, ux = (target.tankPos.vx - bot.tankPos.vx) / (best || 1), uy = (target.tankPos.vy - bot.tankPos.vy) / (best || 1);
      if (best > preferred * 1.2) dir = botHeading(bot, target.tankPos, lvl);
      else if (best < preferred * .6) dir = { x: -ux, y: -uy };
      else {
        if (bot._strafeT <= 0) { bot._strafe *= -1; bot._strafeT = .7 + Math.random() * 1.1; }
        dir = { x: -uy * bot._strafe, y: ux * bot._strafe };
      }
    } else {
      const dest = target ? target.tankPos : bot._dest;
      dir = dest ? botHeading(bot, dest, lvl) : null;
    }
    if (bot._escapeT > 0) dir = { x: Math.cos(bot._direction), y: Math.sin(bot._direction) };
    // Team mode: teammates spread out instead of walking in a single clump.
    if (dir && g.team && bot._dodgeT <= 0 && !(target && lvl.strafe && bot._sees)) {
      let rx = 0, ry = 0;
      g.tanks.forEach(m => {
        if (m === bot || !m.tankAlive || m.team !== bot.team) return;
        const d = distance(bot.tankPos, m.tankPos);
        if (d > 1 && d < 450) { const w = 1 - d / 450; rx += (bot.tankPos.vx - m.tankPos.vx) / d * w; ry += (bot.tankPos.vy - m.tankPos.vy) / d * w; }
      });
      if (rx || ry) { const nx = dir.x + rx * 1.2, ny = dir.y + ry * 1.2, l = Math.hypot(nx, ny) || 1; dir = { x: nx / l, y: ny / l }; }
    }
    if (dir) {
      const step = lvl.speed * LOCAL_SPEED_SCALE * dt, before = { ...bot.tankPos };
      moveLocalTank(bot, dir.x * step, dir.y * step);
      bot.tankBodyAngle = Math.atan2(dir.y, dir.x);
      // Anti-stuck: if the bot has barely moved for ~0.7 s, drop the route and back out in a random direction.
      if (distance(before, bot.tankPos) < step * .25) bot._stuckT = (bot._stuckT || 0) + dt; else bot._stuckT = Math.max(0, (bot._stuckT || 0) - dt * 2);
      if (bot._stuckT > .7) {
        bot._stuckT = 0; bot._escapeT = .6 + Math.random() * .5; bot._direction = Math.random() * Math.PI * 2;
        bot._path = []; bot._wp = null; bot._roam = null; bot._roamUntil = 0; bot._think = 0;
      }
      if (distance(before, bot.tankPos) < step * .25) {   // blocked
        bot._dodgeT = 0;
        if (lvl.strafe && bot._strafeT < .3) { bot._strafe *= -1; bot._strafeT = .5; }
        if (!lvl.path) { bot._direction = Math.random() * Math.PI * 2; bot._dirTimer = .8 + Math.random() * 1.5; }
        else bot._think = Math.min(bot._think, .05);
      }
    }

    // 5. Aim and fire.
    const maxTurn = lvl.turn * dt;
    if (!target) { bot.tankTurretAngle = turnToward(bot.tankTurretAngle, bot.tankBodyAngle, maxTurn); bot._seen = 0; return; }
    let ax = target.tankPos.vx, ay = target.tankPos.vy;
    if (lvl.lead > 0) {
      const flight = Math.min(best / (400 * LOCAL_SPEED_SCALE), 1.5);
      const vmax = 320 * LOCAL_SPEED_SCALE, vl = Math.hypot(target._v.vx, target._v.vy) || 1, vk = Math.min(1, vmax / vl);   // never lead on a teleport spike
      ax += target._v.vx * vk * flight * lvl.lead; ay += target._v.vy * vk * flight * lvl.lead;
      ax = clamp(ax, 0, localMap.width); ay = clamp(ay, 0, localMap.height);
    }
    const wanted = Math.atan2(ay - bot.tankPos.vy, ax - bot.tankPos.vx);
    bot.tankTurretAngle = turnToward(bot.tankTurretAngle, wanted, maxTurn);
    bot._seen = bot._sees ? bot._seen + dt : 0;
    const holdFire = target.tankInvulnerabilityLeft > .25;
    if (bot._sees && !holdFire && bot._cooldown <= 0 && bot._seen >= lvl.react && angleGap(bot.tankTurretAngle, wanted) < .12 + lvl.aim * .3) {
      localShoot(bot, bot.tankTurretAngle + (Math.random() - .5) * 2 * lvl.aim, 'NormalBullet');
      bot._cooldown = lvl.fire[0] + Math.random() * (lvl.fire[1] - lvl.fire[0]);
      if (g.zone) bot._cooldown = Math.max(bot._cooldown, RULES.zoneShotDelay);   // control zone: anti-spam delay between shots
    }
  }

  // Where a bot wants to go when nothing is in sight: chase the last place it saw an enemy, answer a teammate's
  // callout, otherwise patrol to a varied point on the map.
  function botDestination(bot, lvl, target) {
    const g = localGame;
    if (target) return target.tankPos;
    const seen = bot._lastSeen;
    if (seen && !g.zone && g.time - seen.t < (lvl.hunt ? 9 : 5) && distance(bot.tankPos, seen.pos) > 240) return seen.pos;
    if (g.team && !g.zone && lvl.path) {
      const call = g.teamSeen[bot.team];
      if (call && g.time - call.t < 6 && distance(bot.tankPos, call.pos) > 500) return openPointNear(call.pos);
    }
    if (!bot._roam || distance(bot.tankPos, bot._roam) < 240 || g.time > bot._roamUntil) {
      bot._roam = pickPatrolPoint(bot, lvl);
      bot._roamUntil = g.time + 12 + Math.random() * 10;
    }
    return bot._roam;
  }

  function pickPatrolPoint(bot, lvl) {
    const g = localGame, W = localMap.width, H = localMap.height, margin = 260;
    if (g.zone) {
      // Control zone: most bots go and hold the zone, the others circle around it to flank.
      const z = g.zone, ang = Math.random() * Math.PI * 2;
      const d = bot._role === 'flank' ? z.radius * (1.5 + Math.random() * .9) : Math.sqrt(Math.random()) * z.radius * .65;
      return openPointNear({ vx: z.cx + Math.cos(ang) * d, vy: z.cy + Math.sin(ang) * d });
    }
    if (g.team) {
      // Push along a lane between the two bases; every teammate takes its own lane and some flank wide.
      const mates = g.tanks.filter(t => t.team === bot.team), foes = g.tanks.filter(t => t.team !== bot.team);
      const own = mates[0]._spawn, foe = foes[0]._spawn;
      const dx = foe.vx - own.vx, dy = foe.vy - own.vy, len = Math.hypot(dx, dy) || 1;
      const px = -dy / len, py = dx / len;
      const lane = (mates.indexOf(bot) - (mates.length - 1) / 2) * 1000 * (Math.random() < .25 ? 2.2 : 1);
      const aliveFoes = foes.filter(f => f.tankAlive);
      if (aliveFoes.length && aliveFoes.length <= 2 && Math.random() < .6) {   // endgame: close in on the area of the last enemies
        const f = aliveFoes[Math.floor(Math.random() * aliveFoes.length)];
        return openPointNear({ vx: f.tankPos.vx + (Math.random() - .5) * 1600, vy: f.tankPos.vy + (Math.random() - .5) * 1600 });
      }
      const t = .3 + Math.random() * .65, jitter = () => (Math.random() - .5) * 500;
      return openPointNear({ vx: own.vx + dx * t + px * lane + jitter(), vy: own.vy + dy * t + py * lane + jitter() });
    }
    // Free-for-all: hunting bots sometimes head for the rough area of an enemy, others visit a different zone.
    if (lvl.hunt && Math.random() < .35) {
      const foes = g.tanks.filter(t => t !== bot && t.tankAlive);
      if (foes.length) {
        const f = foes[Math.floor(Math.random() * foes.length)];
        return openPointNear({ vx: f.tankPos.vx + (Math.random() - .5) * 2000, vy: f.tankPos.vy + (Math.random() - .5) * 2000 });
      }
    }
    const zones = [];
    for (let zy = 0; zy < 3; zy++) for (let zx = 0; zx < 3; zx++) {
      const idx = zy * 3 + zx;
      if (idx === bot._zone) continue;
      zones.push({ idx, zx, zy, w: zx === 1 && zy === 1 ? .35 : (zx !== 1 && zy !== 1 ? 1.3 : 1) });   // the centre is the least attractive
    }
    let roll = Math.random() * zones.reduce((sum, z) => sum + z.w, 0), zone = zones[0];
    for (const z of zones) { roll -= z.w; if (roll <= 0) { zone = z; break; } }
    bot._zone = zone.idx;
    return openPointNear({ vx: margin + (zone.zx + Math.random()) * (W - margin * 2) / 3, vy: margin + (zone.zy + Math.random()) * (H - margin * 2) / 3 });
  }

  function openPointNear(p, radius = LOCAL_TANK_RADIUS + 10) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const spread = 60 + attempt * 25;
      const pt = { vx: clamp(p.vx + (Math.random() - .5) * spread * 2, 190, localMap.width - 190), vy: clamp(p.vy + (Math.random() - .5) * spread * 2, 190, localMap.height - 190) };
      if (!collidesLocalMap(pt, radius)) return pt;
    }
    return pickOpenLocalPoint(radius);
  }

  function visionRadius() {
    return RULES.rangeStuds * (localMap ? (localMap.baseCellSize || localMap.cellSize) : 352);
  }

  // Per-tank timers: survival points (alive only), respawn countdown, invulnerability and magazine reload.
  function tickLocalTank(tank, dt) {
    if (dt > 0) {
      tank._v = { vx: (tank.tankPos.vx - tank._prev.vx) / dt, vy: (tank.tankPos.vy - tank._prev.vy) / dt };
      tank._prev = { ...tank.tankPos };
    }
    if (tank.tankAlive) {
      tank.tankInvulnerabilityLeft = Math.max(0, tank.tankInvulnerabilityLeft - dt);
      tank._powerBuff = Math.max(0, Number(tank._powerBuff || 0) - dt);
      tank._survival += dt;
      const whole = Math.floor(tank._survival);
      if (whole > 0) { tank.tankPoints += whole * RULES.survivalPoints; tank._survival -= whole; }
    } else if (!(localGame && localGame.team && !localGame.zone)) {   // round team mode: dead tanks stay dead until the next round (control zone: they respawn)
      tank.tankRespawnTimer = Math.max(0, tank.tankRespawnTimer - dt);
      if (tank.tankRespawnTimer === 0) respawnLocalTank(tank);
    }
    if (tank.tankReloadTimer > 0) {
      tank.tankReloadTimer = Math.max(0, tank.tankReloadTimer - dt);
      if (tank.tankReloadTimer === 0) tank.tankAmmo = tank.tankMaxAmmo;
    }
  }

  function respawnLocalTank(tank) {
    const g = localGame;
    // Tử chiến has no fixed base: every respawn picks one of the four map
    // corners. Prefer an unoccupied corner when possible, but still choose
    // randomly from all four if every corner is contested.
    if (g && !g.team) {
      const corners = getLocalSpawns(localMap);
      const safeCorners = corners.filter(corner => g.tanks.every(other =>
        other === tank || !other.tankAlive || distance(other.tankPos, corner) > LOCAL_TANK_RADIUS * 5
      ));
      const pool = safeCorners.length ? safeCorners : corners;
      const nextSpawn = pool[Math.floor(Math.random() * pool.length)];
      if (nextSpawn) tank._spawn = { ...nextSpawn };
    }
    tank.tankPos = { ...tank._spawn };
    tank.tankVel = { vx: 0, vy: 0 };
    tank.tankAlive = true;
    tank.tankRespawnTimer = 0;
    tank.tankInvulnerabilityLeft = RULES.invulnerableSeconds;
    // A respawned tank always starts with a full magazine and no leftover reload.
    tank.tankAmmo = tank.tankMaxAmmo;
    tank.tankReloadTimer = 0;
    tank._powerBuff = 0;
    tank._survival = 0;
    tank._cooldown = 1.2;
    tank._prev = { ...tank.tankPos }; tank._v = { vx: 0, vy: 0 };
    tank._path = []; tank._wp = null; tank._dodgeT = 0; tank._seen = 0;
    tank._lastSeen = null; tank._targetId = null; tank._roam = null; tank._dest = null; tank._sees = false; tank._stuckT = 0; tank._escapeT = 0; tank._losCheck = 0; tank._think = Math.random() * .3;
    if (tank === g.tanks[0]) {
      g.spectatorTankId = '';
      g.fireCooldown = 0;
      updateLocalCamera(tank.tankPos, 1);
      if (!g.team || g.zone) addFeed(`Bạn đã hồi sinh. Bất tử ${RULES.invulnerableSeconds} giây, đạn đầy ${tank.tankMaxAmmo}/${tank.tankMaxAmmo}.`);
    }
  }

  function startLocalReload(tank) {
    if (!tank.tankAlive || tank.tankReloadTimer > 0 || tank.tankAmmo >= tank.tankMaxAmmo) return false;
    tank.tankReloadTimer = RULES.reloadSeconds;
    return true;
  }

  // Scoring: +10 per kill, +20 extra when the victim had a streak of 3 or more (shutdown).
  function killLocalTank(killer, victim) {
    const g = localGame, player = g.tanks[0];
    const victimStreak = victim.tankKillStreak;
    const shutdown = victimStreak >= RULES.streakStart;
    const points = RULES.killPoints + (shutdown ? RULES.shutdownBonus : 0);
    killer.tankKills++; killer.tankKillStreak++; killer.tankPoints += points;
    victim.tankDeaths++; victim.tankKillStreak = 0;
    victim.tankAlive = false; victim.tankVel = { vx: 0, vy: 0 };
    victim.tankRespawnTimer = g.zone ? RULES.zoneRespawn : g.team ? 0 : RULES.respawnSeconds; victim.tankInvulnerabilityLeft = 0;
    victim.tankReloadTimer = 0; victim._powerBuff = 0; victim._survival = 0;
    victim._multi = { count: 0, last: -999 };
    const multi = killer._multi;
    multi.count = g.time - multi.last <= RULES.multiKillWindow ? multi.count + 1 : 1;
    multi.last = g.time;
    if (victim === player) {
      g.spectatorTankId = killer.tankId;
      input.fire = false;
      setMovementSound(false);
      stopShotSounds();
      playSfx('explosion', .62 * SFX_MIX.explosion);
    } else {
      playSfx('explosion', .47 * SFX_MIX.explosion);
    }
    announceKill({ killer: killer.tankId, victim: victim.tankId, tier: Math.min(multi.count, 5), streak: killer.tankKillStreak, shutdown, points });
  }

  // Mystery Box rewards are intentionally local to practice mode: the offline
  // simulator owns its state, so every pickup can immediately affect movement,
  // firing, shields and team revives without a round-trip to the server.
  function addLocalEffect(kind, pos, options = {}) {
    const g = localGame; if (!g || !pos) return;
    const duration = options.duration ?? 2;
    g.effects.push({ kind, pos: { ...pos }, owner: options.owner || '', reward: options.reward || '', life: duration, duration });
  }

  function removeTankWithBomb(tank) {
    const g = localGame; if (!g || !tank || !tank.tankAlive) return;
    tank.tankAlive = false; tank.tankVel = { vx: 0, vy: 0 }; tank.tankDeaths++;
    tank.tankKillStreak = 0; tank.tankRespawnTimer = g.zone ? RULES.zoneRespawn : g.team ? 0 : RULES.respawnSeconds;
    tank.tankInvulnerabilityLeft = 0; tank.tankReloadTimer = 0; tank._powerBuff = 0; tank._survival = 0;
    if (tank === g.tanks[0]) {
      g.spectatorTankId = g.tanks.slice(1).find(other => other.tankAlive)?.tankId || '';
      input.fire = false; setMovementSound(false); stopShotSounds();
    }
    playSfx('explosion', .66 * SFX_MIX.explosion);
  }

  function reviveOfflineAlly(picker) {
    const g = localGame;
    const ally = g && g.team ? g.tanks.find(tank => tank !== picker && tank.team === picker.team && !tank.tankAlive) : null;
    if (!ally) return false;
    respawnLocalTank(ally);
    g.heartSequence = { life: 2, duration: 2 };
    return true;
  }

  function collectLocalMysteryBox(picker, box) {
    const g = localGame; if (!g) return;
    addLocalEffect('boxBroken', box.pos);
    const weapons = ['ShotgunBullet', 'LaserBullet', 'WallPiercingBullet', 'GatlingBullet'];
    const rewards = weapons.concat(['shield', 'power', 'bomb']);
    if (g.team && g.tanks.some(tank => tank.team === picker.team && !tank.tankAlive)) rewards.push('revive', 'revive');
    const reward = rewards[Math.floor(Math.random() * rewards.length)];
    const owner = picker.tankId;
    if (weapons.includes(reward)) {
      picker.tankWeapon.wsCurrentWeapon = reward;
      picker.tankWeapon.wsBuffTimeLeft = 15;
      addLocalEffect('weapon', box.pos, { owner, reward });
      addFeed(`Mystery Box: ${weaponName(reward)} trong 15 giây!`);
    } else if (reward === 'shield') {
      picker.tankInvulnerabilityLeft = Math.max(picker.tankInvulnerabilityLeft, 5);
      addLocalEffect('reward', box.pos, { owner, reward });
      addFeed('Mystery Box: Khiên bất tử trong 5 giây!');
    } else if (reward === 'power') {
      picker._powerBuff = 3;
      addLocalEffect('reward', box.pos, { owner, reward });
      addFeed('Mystery Box: Tăng tốc chạy và bắn trong 3 giây!');
    } else if (reward === 'revive' && reviveOfflineAlly(picker)) {
      addLocalEffect('reward', box.pos, { owner, reward });
      addFeed('Mystery Box: Đã hồi sinh một đồng đội!');
    } else {
      // A bomb reward kills the collector. Its reward art is owner-bound, so it
      // vanishes in the same frame as the destroyed tank; the broken box stays 2s.
      addLocalEffect('reward', box.pos, { owner, reward: 'bomb' });
      removeTankWithBomb(picker);
      g.effects = g.effects.filter(effect => effect.kind === 'boxBroken' || effect.owner !== owner);
      addFeed('Mystery Box: BOM! Bạn đã bị phá huỷ.', 'warn');
    }
    playSfx('pickup', .58);
  }

  function updateLocalEffects(dt) {
    const g = localGame; if (!g) return;
    g.effects.forEach(effect => { effect.life -= dt; });
    g.effects = g.effects.filter(effect => {
      if (effect.life <= 0) return false;
      return !effect.owner || g.tanks.some(tank => tank.tankId === effect.owner && tank.tankAlive);
    });
    if (g.heartSequence) {
      g.heartSequence.life -= dt;
      if (g.heartSequence.life <= 0) g.heartSequence = null;
    }
  }

  function updateOffline(dt) {
    if (!localGame || localGame.gameOver || isPaused || localGame.awaitingNext) return;
    // Pre-match countdown: nobody moves, shoots or scores until it reaches zero.
    if (localGame.startCountdown > 0) {
      localGame.startCountdown = Math.max(0, localGame.startCountdown - dt);
      input.fire = false; input.reloadRequest = false;
      setMovementSound(false);
      if (localGame.startCountdown > 0) updateCountdownOverlay(localGame.startCountdown); else removeCountdownOverlay();
      return;
    }
    const g = localGame; g.time += dt; g.fireCooldown = Math.max(0, g.fireCooldown - dt); updateLocalEffects(dt);
    if (!g.team && g.time >= botSettings.matchSeconds) { finishLocalMatch(); return; }
    if (g.team && !g.zone && !g.roundOver) g.roundClock += dt;
    const player = g.tanks[0];
    const weapon = player.tankWeapon;
    g.tanks.forEach(tank => tickLocalTank(tank, dt));
    if (input.reloadRequest) { input.reloadRequest = false; startLocalReload(player); }
    if (player.tankAlive) {
      const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0), dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        const speedMultiplier = player._powerBuff > 0 ? 1.55 : 1;
        const mx = dx / len * 150 * speedMultiplier * LOCAL_SPEED_SCALE * dt, my = dy / len * 150 * speedMultiplier * LOCAL_SPEED_SCALE * dt;
        moveLocalTank(player, mx, my);
        player.tankBodyAngle = Math.atan2(dy, dx);
      }
      setMovementSound(!!(dx || dy));
      updateLocalCamera(player.tankPos, dt);
      const pointer = screenToLocalWorld(input.mouseX, input.mouseY);
      player.tankTurretAngle = Math.atan2(pointer.vy - player.tankPos.vy, pointer.vx - player.tankPos.vx);
    } else {
      input.fire = false;
      setMovementSound(false);
      const killer = (g.team ? getOfflineCameraTank() : null)
        || g.tanks.find(tank => tank.tankId === g.spectatorTankId && tank.tankAlive)
        || g.tanks.slice(1).find(tank => tank.tankAlive);
      if (killer) updateLocalCamera(killer.tankPos, dt);
    }
    weapon.wsBuffTimeLeft = Math.max(0, weapon.wsBuffTimeLeft - dt);
    if (weapon.wsBuffTimeLeft <= 0 && weapon.wsCurrentWeapon !== 'NormalBullet') weapon.wsCurrentWeapon = 'NormalBullet';
    if (player.tankAlive && input.fire && g.fireCooldown <= 0 && player.tankReloadTimer <= 0 && player.tankAmmo > 0) {
      localShoot(player, player.tankTurretAngle, weapon.wsCurrentWeapon);
      const baseFireCooldown = weapon.wsCurrentWeapon === 'NormalBullet' ? 0.5 : 1.0;
      g.fireCooldown = baseFireCooldown * (player._powerBuff > 0 ? .52 : 1);
      if (g.zone) g.fireCooldown = Math.max(g.fireCooldown, RULES.zoneShotDelay);   // control zone: anti-spam delay between shots
      player.tankAmmo--;
      if (player.tankAmmo === 0) startLocalReload(player);
    }
    weapon.wsCooldownState = g.fireCooldown > 0 || player.tankReloadTimer > 0
      ? { tag: 'Reloading', contents: Math.max(g.fireCooldown, player.tankReloadTimer) }
      : 'Ready';

    g.boxTimer -= dt;
    if (g.boxTimer <= 0 && g.boxes.length === 0) {
      const pt = pickOpenLocalPoint(26);
      g.boxes.push({ pos: { ...pt }, life: 12, spawnedAt: g.time }); g.boxTimer = 22 + Math.random() * 8;
    }
    g.boxes.forEach(box => box.life -= dt); g.boxes = g.boxes.filter(b => b.life > 0);
    const hitBox = player.tankAlive && g.boxes.find(box => distance(box.pos, player.tankPos) < LOCAL_TANK_RADIUS + 56);
    if (hitBox) {
      g.boxes = g.boxes.filter(box => box !== hitBox);
      collectLocalMysteryBox(player, hitBox);
    }

    g.tanks.slice(1).forEach(bot => { if (bot.tankAlive) updateLocalBot(bot, dt); });

    g.bullets.forEach(b => {
      b.life -= dt; const nx = b.pos.vx + b.vel.vx * dt, ny = b.pos.vy + b.vel.vy * dt;
      b.travelled = (b.travelled || 0) + Math.hypot(b.vel.vx * dt, b.vel.vy * dt);   // path length incl. bounces
      if (nx < 12 || nx > localMap.width - 12 || ny < 12 || ny > localMap.height - 12) {
        b.life = 0;
      } else {
        b.pos.vx = nx;
        b.pos.vy = ny;
      }
      if (b.type !== 'WallPiercingBullet' && collidesLocalMap(b.pos, 12)) b.life = 0;
      if (b.travelled >= RULES.bulletRangeMap * LOCAL_WORLD_SIZE) b.life = 0;   // out of range
      if (b.life <= 0) return;
      const ownerTank = g.tanks.find(t => t.tankId === b.owner);
      for (const tank of g.tanks) {
        // A shot never hurts its owner, and passes through a tank still in its post-respawn invulnerability window.
        if (tank.tankId === b.owner || !tank.tankAlive || tank.tankInvulnerabilityLeft > 0) continue;
        // Team mode: no friendly fire, and nobody can be hit once the round is already decided.
        if (g.team && (g.roundOver || (ownerTank && tank.team === ownerTank.team))) continue;
        if (distance(tank.tankPos, b.pos) < LOCAL_TANK_RADIUS + 14) {
          b.life = 0;
          killLocalTank(g.tanks.find(t => t.tankId === b.owner) || tank, tank);
          break;
        }
      }
    });
    g.bullets = g.bullets.filter(b => b.life > 0 );
    if (g.zone) updateZone(dt);
    else if (g.team) updateTeamRound(dt);
    if (!g.gameOver && player.tankKills >= TEST_GAME.winKills) {
      g.gameOver = true;
      setMovementSound(false);
      stopShotSounds();
      playEndSfx(true);
      showEndSplash('win', () => showPostMatch({ title: 'NHIỆM VỤ HOÀN TẤT', summary: `Bạn đã hạ ${player.tankKills} bot và ghi ${player.tankPoints} điểm.`, kills: player.tankKills, score: player.tankPoints, map: localMap.label, scores: g.tanks.map(t => [t.tankId, t.tankPoints]) }));
    }
  }

  // ---- Control zone mode (Cấm Địa) ----
  // Progress speed of a team: x1 normally. Once the OTHER team has reached 50 %, the team still below 50 % is x1.2 faster
  // until it reaches 50 % too. A team at 70 % or more is x1.1 faster until the end of the match.
  function zoneRateMult(z, t) {
    const mine = z.progress[t], other = z.progress[1 - t];
    if (mine >= 70) return RULES.zoneSpeedAt70;
    if (other >= 50 && mine < 50) return RULES.zoneSpeedBehindAt50;
    return 1;
  }

  function updateZone(dt) {
    const g = localGame, z = g && g.zone;
    if (!z || g.gameOver) return;
    if (z.orbitRadius > 0) {
      z.orbitAngle = (z.orbitAngle + Math.PI * 2 * dt / z.orbitPeriod) % (Math.PI * 2);
      z.cx = z.anchorX + Math.cos(z.orbitAngle) * z.orbitRadius;
      z.cy = z.anchorY + Math.sin(z.orbitAngle) * z.orbitRadius;
    }
    const centre = { vx: z.cx, vy: z.cy };
    z.inside = [0, 0];
    g.tanks.forEach(t => { if (t.tankAlive && distance(t.tankPos, centre) <= z.radius) z.inside[t.team]++; });
    if (!z.openVoiceDone) { z.openVoiceDone = true; playSfx('zoneOpenVoice', 1); }   // "The control zone opens in 10 seconds"
    if (!z.open) {   // locked: tanks already fight, the zone is closed
      z.lockLeft = Math.max(0, z.lockLeft - dt);
      if (z.lockLeft <= 0) {
        z.open = true; z.elapsed = 0;
        playSfx('zoneStartVoice', 1);   // the clock starts from 00:00 right now
        showKillBanner('CONTROL ZONE OPEN', 'Chiếm vùng trung tâm để tăng tiến trình!', 'round-start', 'CẤM ĐỊA', 3200);
        addFeed('Control zone đã mở!');
      }
      return;
    }
    z.elapsed += dt;
    const [a, b] = z.inside;
    if (a !== b) z.owner = a > b ? 0 : 1;
    const contested = a > 0 && b > 0;
    if (z.progress[0] >= 99 && z.progress[1] >= 99) {
      // Both teams at 99 %: the final showdown. The team with MORE tanks inside must keep that lead for 5 s in a row.
      // The yellow bar resets at once when the numbers become equal, the lead changes hands or the leader leaves the zone.
      if (!z.overtime) {
        z.overtime = true; z.hold = 0; z.holdTeam = -1;
        showKillBanner('TRANH ĐOẠT', `Áp đảo số xe trong vùng ${RULES.zoneContestSeconds} giây liên tục để thắng!`, 'matchpoint', 'ZONE CONTEST', 3400);
      }
      const lead = a === b ? -1 : a > b ? 0 : 1;
      if (lead !== z.holdTeam) { z.holdTeam = lead; z.hold = 0; }
      if (lead >= 0) {
        z.hold += dt;
        if (z.hold >= RULES.zoneContestSeconds) { z.progress[lead] = 100; finishZoneMatch(lead, 'contest'); return; }
      }
    } else {
      if (a !== b) {   // equal numbers (or an empty zone) freeze both bars
        const t = a > b ? 0 : 1;
        z.progress[t] = Math.min(contested ? 99 : 100, z.progress[t] + 100 / RULES.zoneCaptureSeconds * zoneRateMult(z, t) * dt);
        if (z.progress[t] >= 100) { finishZoneMatch(t, 'capture'); return; }
      }
    }
    // 50 %: the first team to get there triggers the "control rate has increased" announcement.
    if (!z.rateVoiceDone && Math.max(z.progress[0], z.progress[1]) >= 50) { z.rateVoiceDone = true; playSfx('rateIncrease', 1); }
    // 70 %: each team gets its own banner when it reaches 70 % (blue = ours, red = the enemy).
    const myTeam = g.tanks[0].team;
    [0, 1].forEach(t => {
      if (z.progress[t] < RULES.zoneMusicAt || z.shown70[t]) return;
      z.shown70[t] = true;
      const mine = t === myTeam;
      showKillBanner(mine ? 'SẮP THẮNG RỒI, CỐ LÊN!' : 'CHƯA THUA ĐÂU, GẮNG LÊN!', mine ? `Đội bạn đã chiếm ${RULES.zoneMusicAt}% vùng` : `Đội địch đã chiếm ${RULES.zoneMusicAt}% vùng`, mine ? 'zone-hope' : 'zone-fight', 'CẤM ĐỊA', 3200);
    });
    // The progress soundtrack replaces the match music until the end.
    const boost = Math.max(z.progress[0], z.progress[1]) >= RULES.zoneMusicAt;
    if (boost && !zoneBoostBroken && !zoneBoostActive) { zoneBoostActive = true; syncMusicForScreen(); }
  }

  function finishZoneMatch(winner, reason) {
    const g = localGame; if (!g || g.gameOver || !g.zone) return;
    g.gameOver = true;
    zoneBoostActive = false;
    input.fire = false;
    setMovementSound(false);
    stopShotSounds();
    const me = g.tanks[0], my = me.team, z = g.zone;
    const outcome = winner < 0 ? 'draw' : winner === my ? 'win' : 'lose';
    playEndSfx(outcome === 'win');   // gamewinner / gameover (the free-for-all jingles)
    const pct = team => `${Math.floor(z.progress[team])}%`;
    const why = reason === 'contest' ? 'GIÀNH QUYỀN TRANH ĐOẠT.' : 'CHIẾM ĐỦ 100%.';
    const ranking = g.tanks.slice().sort((a, b) => b.tankPoints - a.tankPoints || b.tankKills - a.tankKills || a.tankDeaths - b.tankDeaths);
    showEndSplash(outcome, () => showPostMatch({
      title: outcome === 'win' ? 'VICTORY' : outcome === 'lose' ? 'DEFEAT' : 'DRAW',
      summary: `Cấm Địa ${g.teamSize}V${g.teamSize} · ${why} PHE TA: ${pct(my)} - PHE ĐỊCH: ${pct(1 - my)}.`,
      kills: me.tankKills, score: me.tankPoints, map: localMap.label,
      scores: ranking.map(t => [`${t.tankId} · ${t.team === my ? 'ĐỒNG ĐỘI' : 'ĐỊCH'}`, t.tankPoints]),
      players: matchPlayers(g), report: { team: true, myTeam: my, outcome, zone: { progress: z.progress.slice() } }
    }));
  }

  // Progress bars (blue left, red right), locked with a countdown, then percentages + tanks inside the zone.
  function updateZoneHud() {
    const box = $('zone-hud'); if (!box) return;
    const g = hudGame();
    if (!g || !g.zone) { if (!box.hidden) box.hidden = true; return; }
    if (box.hidden) box.hidden = false;
    const z = g.zone;
    box.classList.toggle('open', z.open);
    const fillBlue = $('zone-fill-blue'), fillRed = $('zone-fill-red');
    if (fillBlue) fillBlue.style.width = `${z.progress[0]}%`;
    if (fillRed) fillRed.style.width = `${z.progress[1]}%`;
    setText('zone-pct-blue', `${Math.floor(z.progress[0])}%`);
    setText('zone-pct-red', `${Math.floor(z.progress[1])}%`);
    setText('zone-center', z.open ? formatClock(z.elapsed) : formatClock(Math.ceil(z.lockLeft)));   // locked: counts 00:10 -> 00:01, then 00:00 upwards
    const dots = (n, size) => '●'.repeat(Math.min(n, size)) + '○'.repeat(Math.max(0, size - n));
    setText('zone-in-blue', z.inside[0]); setText('zone-in-red', z.inside[1]);
    setText('zone-dots-blue', dots(z.inside[0], g.teamSize)); setText('zone-dots-red', dots(z.inside[1], g.teamSize));
    let status = '', warn = false;
    if (!z.open) status = 'CONTROL ZONE ĐANG KHÓA';
    else if (z.overtime) { status = `TRANH ĐOẠT · ${z.holdTeam < 0 ? 'CHƯA ĐỘI NÀO ÁP ĐẢO' : z.holdTeam === 0 ? 'XANH ĐANG ÁP ĐẢO' : 'ĐỎ ĐANG ÁP ĐẢO'}`; warn = true; }
    else if (z.inside[0] === z.inside[1] && z.inside[0] > 0) { status = ''; }
    else if (z.inside[0] === 0 && z.inside[1] === 0) status = 'VÙNG TRỐNG';
    else status = z.inside[0] > z.inside[1] ? 'ĐỘI XANH ĐANG CHIẾM VÙNG' : 'ĐỘI ĐỎ ĐANG CHIẾM VÙNG';
    setText('zone-status', status);
    const holdBox = $('zone-hold'), holdFill = $('zone-hold-fill');   // yellow showdown bar (under the two progress bars)
    if (holdBox) holdBox.style.visibility = z.overtime ? 'visible' : 'hidden';
    if (holdFill) { holdFill.style.transition = z.hold <= 0 ? 'none' : ''; holdFill.style.width = `${clamp(z.hold / RULES.zoneContestSeconds, 0, 1) * 100}%`; }
    const statusEl = $('zone-status'); if (statusEl) statusEl.classList.toggle('warn', warn);
  }

  // Capture zone drawn on the canvas, under the tanks.
  function drawControlZone() {
    const g = hudGame(), z = g && g.zone; if (!z) return;
    const s = localWorldScale(), c = localToScreen({ vx: z.cx, vy: z.cy }), r = z.radius * s;
    if (c.x + r < 0 || c.x - r > WORLD_W || c.y + r < 0 || c.y - r > WORLD_H) return;
    const TAU = Math.PI * 2, T = performance.now() / 1000;
    const contested = z.inside[0] > 0 && z.inside[1] > 0;
    const rgb = !z.open ? '170,176,186' : z.owner === 0 ? '80,160,255' : z.owner === 1 ? '255,90,80' : '235,240,245';
    const pulse = .5 + .5 * Math.sin(T * (contested ? 7 : 2.2));
    // The canvas is rendered into a non-square logical viewport. Compensate
    // for that anisotropic scale before every circular zone primitive so the
    // objective is mathematically round on screen, not an ellipse.
    const pixelX = canvas.width / WORLD_W, pixelY = canvas.height / WORLD_H;
    const yCompensation = pixelX / pixelY;
    ctx.save(); ctx.translate(c.x, c.y); ctx.scale(1, yCompensation);
    const disc = ctx.createRadialGradient(0, 0, r * .12, 0, 0, r);
    disc.addColorStop(0, `rgba(${rgb}, .05)`); disc.addColorStop(.68, `rgba(${rgb}, .13)`); disc.addColorStop(1, `rgba(${rgb}, ${(z.open ? .3 : .22) + pulse * .06})`);
    ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    const flash = z.overtime && Math.floor(T * 4) % 2;
    ctx.shadowColor = `rgba(${flash ? '255,212,93' : rgb}, .9)`; ctx.shadowBlur = 14;
    ctx.strokeStyle = flash ? 'rgba(255,212,93,.97)' : `rgba(${rgb}, .95)`; ctx.lineWidth = Math.max(2, 9 * s);
    if (!z.open) ctx.setLineDash([r * .16, r * .08]);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]); ctx.shadowBlur = 0;
    ctx.save(); ctx.rotate(T * .25);
    ctx.strokeStyle = `rgba(${rgb}, .42)`; ctx.lineWidth = Math.max(1.5, 5 * s); ctx.setLineDash([r * .12, r * .09]);
    ctx.beginPath(); ctx.arc(0, 0, r * .93, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.rotate(-T * .5 - T * .25);
    ctx.strokeStyle = `rgba(${rgb}, .5)`; ctx.lineWidth = Math.max(1.5, 6 * s); ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const ang = i * TAU / 12; ctx.beginPath(); ctx.moveTo(Math.cos(ang) * r * .76, Math.sin(ang) * r * .76); ctx.lineTo(Math.cos(ang) * r * .82, Math.sin(ang) * r * .82); ctx.stroke(); }
    ctx.restore();
    if (z.open) {
      const rr = r * .64, top = -Math.PI / 2;
      ctx.lineCap = 'round'; ctx.lineWidth = Math.max(3, 15 * s);
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
      if (z.progress[0] > 0) { ctx.shadowColor = 'rgba(80,160,255,.9)'; ctx.shadowBlur = 10; ctx.strokeStyle = '#5ca9ff'; ctx.beginPath(); ctx.arc(0, 0, rr, top, top + Math.PI * z.progress[0] / 100); ctx.stroke(); }
      if (z.progress[1] > 0) { ctx.shadowColor = 'rgba(255,90,80,.9)'; ctx.shadowBlur = 10; ctx.strokeStyle = '#ff655d'; ctx.beginPath(); ctx.arc(0, 0, rr, top, top - Math.PI * z.progress[1] / 100, true); ctx.stroke(); }
      ctx.shadowBlur = 0; ctx.lineCap = 'butt';
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (!z.open) {
      const u = r * .2;
      ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(-u, -u * .2, u * 2, u * 1.5);
      ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = Math.max(2, u * .35);
      ctx.beginPath(); ctx.arc(0, -u * .2, u * .65, Math.PI, 0); ctx.stroke();
      ctx.font = `800 ${Math.max(10, r * .38)}px 'Barlow Condensed', sans-serif`; ctx.fillStyle = '#fff4b7';
      ctx.fillText(String(Math.ceil(z.lockLeft)), 0, u * 2.5);
    } else {
      ctx.fillStyle = 'rgba(8,14,9,.5)'; ctx.beginPath(); ctx.arc(0, 0, r * .3, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(${rgb}, .55)`; ctx.lineWidth = Math.max(1, 3 * s); ctx.stroke();
      ctx.font = `800 ${Math.max(10, r * .3)}px 'Barlow Condensed', sans-serif`;
      ctx.fillStyle = '#5ca9ff'; ctx.fillText(String(z.inside[0]), -r * .12, 0);
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText('·', 0, 0);
      ctx.fillStyle = '#ff655d'; ctx.fillText(String(z.inside[1]), r * .12, 0);
    }
    ctx.restore();
  }

  // ---- Team mode rounds (2v2 / 3v3 / 4v4 / 5v5): death match per round, no respawn until the next round ----
  function updateTeamRound(dt) {
    const g = localGame;
    if (!g || !g.team || g.gameOver) return;
    if (!g.roundOver) {
      const alive = [0, 1].map(team => g.tanks.filter(t => t.team === team && t.tankAlive).length);
      if (alive[0] === 0 || alive[1] === 0) endTeamRound(alive[0] === alive[1] ? -1 : (alive[0] ? 0 : 1), 'wipe');
      else if (g.roundClock >= botSettings.teamRoundSeconds) endTeamRound(alive[0] === alive[1] ? -1 : (alive[0] > alive[1] ? 0 : 1), 'time');
      return;
    }
    g.roundEndTimer -= dt;
    // Show the round verdict as a banner (not a blocking screen) shortly after the last kill.
    // After an ACE the verdict waits 2 seconds longer, so the ACE banner and voice are not cut off.
    if (!g.verdictShown && g.roundResult && g.roundEndTimer <= RULES.teamRoundEndDelay - (g.ace ? 0 : 1) && g.roundEndTimer > .4) {
      g.verdictShown = true;
      const my = g.tanks[0].team, w = g.roundResult.winner;
      showKillBanner(g.roundResult.title, g.roundResult.text, w < 0 ? 'round-draw' : w === my ? 'round-win' : 'round-lose', 'ROUND RESULT', Math.max(800, g.roundEndTimer * 1000));
    }
    if (g.roundEndTimer > 0) return;
    // A team that wins more than half of the rounds has already won the match: no need to play on.
    const need = Math.floor(g.rounds / 2) + 1;
    if (g.wins[0] >= need || g.wins[1] >= need || g.round >= g.rounds) { finishTeamMatch(); return; }
    // Next round starts by itself: no button to press.
    startNextTeamRound();
  }

  function endTeamRound(winner, reason) {
    const g = localGame;
    g.roundOver = true; g.verdictShown = false;
    g.roundEndTimer = RULES.teamRoundEndDelay;
    if (winner >= 0) g.wins[winner]++;
    g.history.push(winner);
    const my = g.tanks[0].team;
    // ACE: one team wiped out the whole other team (the round ended by elimination, not by the clock).
    // Your team -> ace.mp3 (gold banner); the enemy team -> enemy_ace.mp3 (red banner).
    g.ace = reason === 'wipe' && winner >= 0;
    if (g.ace) {
      g.roundEndTimer += 2;
      resetAnnouncements();   // the ACE takes over from any kill announcement still queued
      if (winner === my) {
        showKillBanner('ACE', 'Đội bạn đã quét sạch phe địch!', 'ace', 'TEAM WIPE', 2300);
        playVoice('ace', .9, () => playKillSting(5));
      } else {
        showKillBanner('ACE', 'Phe địch đã quét sạch đội bạn!', 'ace enemy', 'TEAM WIPE', 2300);
        playVoice('enemyAce', .9, () => playKillSting(1, true));
      }
    }
    const verdict = winner < 0 ? 'DRAW' : winner === my ? 'ROUND WON' : 'ROUND LOST';
    const why = reason === 'time'
      ? 'Hết giờ, ' + (winner < 0 ? 'số người sống bằng nhau.' : 'đội còn nhiều người sống hơn thắng.')
      : (winner < 0 ? 'Hai đội cùng bị loại.' : winner === my ? 'ENEMY TEAM WIPED OUT!' : 'OUR TEAM WIPED OUT!');
    g.roundResult = { winner, title: winner < 0 ? `${verdict} ${g.round}/${g.rounds}` : verdict, text: `${why} ${g.wins[my] === g.wins[1 - my] ? 'BOTH TEAM ARE TIED' : g.wins[my] > g.wins[1 - my] ? `OUR TEAM IS LEADING WITH ${g.wins[my]} WIN ROUNDS` : `ENEMY TEAM IS LEADING WITH ${g.wins[1 - my]} WIN ROUNDS`}` };
    addFeed(`${verdict} ${g.round}/${g.rounds} · ${g.wins[my]} – ${g.wins[1 - my]}`, 'warn');
  }

  function startNextTeamRound() {
    const g = localGame; if (!g || !g.team || g.gameOver) return;
    g.round++;
    g.roundOver = false; g.awaitingNext = false; g.roundResult = null; g.roundClock = 0;
    g.bullets = []; g.boxes = []; g.effects = []; g.heartSequence = null; g.lasers = []; g.boxTimer = 10; g.fireCooldown = 0; g.spectatorTankId = '';
    g.teamSeen = [null, null];
    input.fire = false;
    // Every round is a fresh death match: new First Blood, no leftover streaks / multi-kills / announcements.
    resetAnnouncements();
    firstBloodDone = false;
    killTracker.clear(); streakTracker.clear(); lastKnownStreak.clear();
    lastKillerOfMe = '';
    const feed = $('kill-feed'); if (feed) feed.innerHTML = '';
    const banner = $('kill-banner'); if (banner) banner.hidden = true;
    clearTimeout(bannerTimer);
    g.tanks.forEach(tank => {
      tank.tankKillStreak = 0; tank._multi = { count: 0, last: -999 };
      tank.tankWeapon.wsCurrentWeapon = 'NormalBullet'; tank.tankWeapon.wsBuffTimeLeft = 0;
      respawnLocalTank(tank);
    });
    addFeed(`Ván ${g.round}/${g.rounds} bắt đầu. Bất tử ${RULES.invulnerableSeconds} giây.`);
    // Match point: some team needs just one more round win to take the match.
    const need = Math.floor(g.rounds / 2) + 1, my = g.tanks[0].team;
    const atPoint = need >= 2 ? [0, 1].filter(t => g.wins[t] === need - 1) : [];
    if (atPoint.length) {
      const who = atPoint.length === 2 ? 'Cả hai đội chỉ còn cách chiến thắng 1 ván' : atPoint[0] === my ? 'Đội bạn chỉ còn cách chiến thắng 1 ván' : 'Đội địch chỉ còn cách chiến thắng 1 ván';
      // matchpoint.mp3 is now the round's music (not a short voice line), so only the banner is queued here.
      matchPointTrack = pickMatchPointTrack(); matchPointActive = !!matchPointTrack;
      queueAnnouncement({ banner: ['MATCH POINT', who, 'matchpoint', `ROUND ${g.round}/${g.rounds}`, 3200] });
      runAnnouncements();
    } else { matchPointActive = false; showKillBanner(`ROUND ${g.round}/${g.rounds}`, 'Bắt đầu!', 'round-start', 'ROUND START', 2200); }
    syncMusicForScreen();
  }

  function finishTeamMatch() {
    const g = localGame; if (!g || g.gameOver) return;
    g.gameOver = true;
    matchPointActive = false;
    input.fire = false;
    setMovementSound(false);
    stopShotSounds();
    const me = g.tanks[0], my = me.team;
    const mine = g.wins[my], theirs = g.wins[1 - my];
    const outcome = mine > theirs ? 'win' : mine < theirs ? 'lose' : 'draw';
    playEndSfx(outcome === 'win', .66, true);
    const ranking = g.tanks.slice().sort((a, b) => b.tankPoints - a.tankPoints || b.tankKills - a.tankKills || a.tankDeaths - b.tankDeaths);
    showEndSplash(outcome, () => showPostMatch({
      title: outcome === 'win' ? 'VICTORY' : outcome === 'lose' ? 'DEFEAT' : 'DRAW',
      summary: `${g.teamSize}V${g.teamSize} · Trận đấu kết thúc sau ${g.history.length}/${g.rounds} ván.`,
      kills: me.tankKills, score: me.tankPoints, map: localMap.label,
      scores: ranking.map(t => [`${t.tankId} · ${t.team === my ? 'ĐỒNG ĐỘI' : 'ĐỊCH'}`, t.tankPoints]),
      players: matchPlayers(g), report: { team: true, myTeam: my, wins: g.wins, history: g.history, outcome }
    }));
  }

  // Round / wins / survivors box under the clock (team mode only).
  function updateRoundScore() {
    const box = $('round-score'); if (!box) return;
    const g = hudGame();
    if (!g || !g.team || g.zone) { if (!box.hidden) box.hidden = true; return; }
    if (box.hidden) box.hidden = false;
    const my = g.tanks[0].team;
    const aliveOf = team => g.tanks.filter(t => t.team === team && t.tankAlive).length;
    setText('round-label', `ROUND ${Math.min(g.round, g.rounds)}/${g.rounds}`);
    setText('round-wins-me', g.wins[my]);
    setText('round-wins-enemy', g.wins[1 - my]);
    setText('round-alive', `SỐNG ${aliveOf(my)} · ${aliveOf(1 - my)}`);
  }

  // Kill totals of both teams (2v2-5v5 and Cấm Địa): small board at the top centre, our team (blue) left, the enemy (red) right.
  // Cấm Địa has no top clock any more (the zone timer in the progress bars already counts the time); the board takes its place.
  function updateKillBoard() {
    const box = $('kill-board'); if (!box) return;
    const clock = $('match-clock');
    const g = hudGame();
    if (!g || !g.team) { if (!box.hidden) box.hidden = true; if (clock && clock.hidden) clock.hidden = false; return; }
    if (box.hidden) box.hidden = false;
    const my = g.tanks[0].team;
    const killsOf = team => g.tanks.reduce((sum, t) => sum + (t.team === team ? t.tankKills : 0), 0);   // tankKills is kept for the whole match (all rounds)
    setText('kb-blue', killsOf(my));
    setText('kb-red', killsOf(1 - my));
    box.classList.toggle('zone', !!g.zone);
    if (clock) {
      if (clock.hidden !== !!g.zone) clock.hidden = !!g.zone;
      if (!g.zone && clock.offsetWidth) box.style.setProperty('--kb-clock', `${clock.offsetWidth}px`);
    }
  }

  // Time is up: the tank with the most points wins (ties: more kills, then fewer deaths).
  function finishLocalMatch() {
    const g = localGame; if (!g || g.gameOver) return;
    g.gameOver = true;
    input.fire = false;
    setMovementSound(false);
    stopShotSounds();
    const ranking = g.tanks.slice().sort((a, b) => b.tankPoints - a.tankPoints || b.tankKills - a.tankKills || a.tankDeaths - b.tankDeaths);
    const winner = ranking[0], me = g.tanks[0];
    const won = winner === me;
    playEndSfx(won);
    showEndSplash(won ? 'win' : 'lose', () => showPostMatch({
      title: won ? 'VICTORY' : 'DEFEAT',
      kills: me.tankKills, score: me.tankPoints, map: localMap.label,
      scores: ranking.map(t => [t.tankId, t.tankPoints]),
      players: matchPlayers(g), report: { team: false, outcome: won ? 'win' : 'lose' }
    }));
  }

  function localShoot(tank, angle, type) {
    if (!localGame) return;
    const isPlayer = tank.tankId === localGame.name;
    const volume = (isPlayer ? .43 : .16) * SFX_MIX.shot;
    // Laser / gatling / piercing use a single restartable voice so they never stack or loop.
    if (type === 'LaserBullet') playShot('laserShot', volume);
    else if (type === 'GatlingBullet') playShot('gatlingShot', volume);
    else if (type === 'WallPiercingBullet') playShot('piercingShot', volume);
    else playSfx('normalShot', volume);
    const muzzleOffset = LOCAL_TANK_SIZE * .44 * Number(TEST_GAME.tankRenderScale || .5);
    const origin = { vx: tank.tankPos.vx + Math.cos(angle) * muzzleOffset, vy: tank.tankPos.vy + Math.sin(angle) * muzzleOffset };
    const add = (a, speed = 390) => localGame.bullets.push({ pos: { ...origin }, vel: { vx: Math.cos(a) * speed * LOCAL_SPEED_SCALE, vy: Math.sin(a) * speed * LOCAL_SPEED_SCALE }, type, owner: tank.tankId, life: 3, bounces: 0, travelled: 0 });
    if (type === 'ShotgunBullet') { add(angle - .22, 340); add(angle, 365); add(angle + .22, 340); }
    else if (type === 'GatlingBullet') { add(angle, 410); add(angle + .04, 410); }
    else if (type === 'LaserBullet') { add(angle, 570); }
    else if (type === 'WallPiercingBullet') { add(angle, 350); }
    else add(angle, 400);
  }

  // Moves in small steps and pushes the tank back out of any wall it touches, so it slides along walls and corners
  // instead of sticking (and a tank that ends up embedded in a wall is freed on its next move).
  function moveLocalTank(tank, deltaX, deltaY) {
    const pos = tank.tankPos, r = LOCAL_TANK_RADIUS;
    const steps = Math.max(1, Math.ceil(Math.hypot(deltaX, deltaY) / 8));
    for (let i = 0; i < steps; i++) {
      pos.vx += deltaX / steps; pos.vy += deltaY / steps;
      pushOutOfLocalMap(pos, r);
    }
  }

  function pushOutOfLocalMap(pos, radius) {
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      const cx = clamp(pos.vx, radius, localMap.width - radius), cy = clamp(pos.vy, radius, localMap.height - radius);
      if (cx !== pos.vx || cy !== pos.vy) { pos.vx = cx; pos.vy = cy; moved = true; }
      for (const rect of localMap.collisionRects) {
        const nx = clamp(pos.vx, rect.x, rect.x + rect.width), ny = clamp(pos.vy, rect.y, rect.y + rect.height);
        const dx = pos.vx - nx, dy = pos.vy - ny, d2 = dx * dx + dy * dy;
        if (d2 >= radius * radius) continue;
        moved = true;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2), k = (radius - d) / d;
          pos.vx += dx * k; pos.vy += dy * k;
        } else {
          // The centre is inside the wall: leave through the nearest side.
          const exits = [
            [pos.vx - rect.x, -1, 0], [rect.x + rect.width - pos.vx, 1, 0],
            [pos.vy - rect.y, 0, -1], [rect.y + rect.height - pos.vy, 0, 1]
          ].sort((a, b) => a[0] - b[0])[0];
          pos.vx += exits[1] * (exits[0] + radius); pos.vy += exits[2] * (exits[0] + radius);
        }
      }
      if (!moved) break;
    }
  }

  function collidesLocalMap(pos, radius) {
    if (!localMap || pos.vx < radius || pos.vx > localMap.width - radius || pos.vy < radius || pos.vy > localMap.height - radius) return true;
    return localMap.collisionRects.some(rect => circleIntersectsRect(pos, radius, rect));
  }

  function circleIntersectsRect(pos, radius, rect) {
    const x = clamp(pos.vx, rect.x, rect.x + rect.width);
    const y = clamp(pos.vy, rect.y, rect.y + rect.height);
    return (pos.vx - x) ** 2 + (pos.vy - y) ** 2 < radius ** 2;
  }

  function pickOpenLocalPoint(radius) {
    for (let attempt = 0; attempt < 160; attempt++) {
      const point = { vx: 190 + Math.random() * (localMap.width - 380), vy: 190 + Math.random() * (localMap.height - 380) };
      if (!collidesLocalMap(point, radius)) return point;
    }
    return { ...getLocalSpawns(localMap)[0] };
  }

  function updateLocalCamera(pos, delta) {
    if (!localMap) return;
    const view = localViewSize();
    const targetX = clamp(pos.vx - view.width / 2, 0, localMap.width - view.width);
    const targetY = clamp(pos.vy - view.height / 2, 0, localMap.height - view.height);
    const blend = Math.min(1, delta * 8);
    camera.x += (targetX - camera.x) * blend;
    camera.y += (targetY - camera.y) * blend;
  }

  function localViewSize() {
    if (!localMap) return { width: WORLD_W, height: WORLD_H };
    const targetWidth = WORLD_W / LOCAL_CAMERA_ZOOM;
    const width = Math.min(targetWidth, localMap.width, localMap.height * WORLD_W / WORLD_H);
    return { width, height: width * WORLD_H / WORLD_W };
  }

  function localWorldScale() { return WORLD_W / localViewSize().width; }
  function localToScreen(pos) {
    const scale = localWorldScale();
    return { x: (pos.vx - camera.x) * scale, y: (pos.vy - camera.y) * scale };
  }
  function screenToLocalWorld(x, y) {
    const scale = localWorldScale();
    return { vx: camera.x + x / scale, vy: camera.y + y / scale };
  }
  function distance(a, b) { return Math.hypot(a.vx - b.vx, a.vy - b.vy); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ---------------------------------------------------------------- render loop

  function startRenderLoop() {
    if (animationId !== null) return;
    lastFrameTime = performance.now();
    const frame = (time) => {
      animationId = requestAnimationFrame(frame);
      const dt = Math.min(.04, Math.max(0, (time - lastFrameTime) / 1000)); lastFrameTime = time;
      if (screenName !== 'game') { removeCountdownOverlay(); return; }
      fpsFrameCount++;
      if (time - fpsLast >= 1000) {
        const fpsLabel = $('fps-label');
        if (fpsLabel) fpsLabel.textContent = `${fpsFrameCount} FPS CLIENT`;
        fpsFrameCount = 0;
        fpsLast = time;
      }
      const smooth = mode === 'online' && latestSnapshot ? smoothSnapshot(latestSnapshot, (time - latestSnapshotAt) / 1000) : null;
      if (mode === 'offline') {
        updateOffline(dt);
        latestSnapshot = localSnapshot();
      } else if (mode === 'online' && latestSnapshot) {
        const myTank = findMyTank(smooth);
        if (myTank && readField(myTank, 'tankAlive') !== false) {
          const pos = readField(myTank, 'tankPos');
          if (pos) updateLocalCamera(pos, dt);
        } else {
          const aliveTanks = (readField(latestSnapshot, 'wsTanks') || []).filter(t => readField(t, 'tankAlive') !== false);
          if (aliveTanks.length > 0) {
            updateLocalCamera(readField(aliveTanks[0], 'tankPos'), dt);
          }
        }
      }
      if (time - lastHudUpdate > 100) {
        lastHudUpdate = time;
        if (mode === 'offline' || mode === 'online') { updateMatchHeader(latestSnapshot); updateWeaponPanel(latestSnapshot); updateScoreboard(latestSnapshot); }
        updateRoundScore();
        updateZoneHud();
        updateKillBoard();
        updateGameplayHud(latestSnapshot);
      }
      renderSnapshot(smooth || latestSnapshot);
    };
    animationId = requestAnimationFrame(frame);
  }
  function stopRenderLoop() { if (animationId !== null) { cancelAnimationFrame(animationId); animationId = null; } }

  function renderSnapshot(snapshot) {
    if (!snapshot) return;
    resizeCanvasBacking();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mode === 'offline' || (mode === 'online' && localMap)) {
      // The offline renderer draws in WORLD_W x WORLD_H units; scale to the real backing buffer.
      ctx.setTransform(canvas.width / WORLD_W, 0, 0, canvas.height / WORLD_H, 0, 0);
      renderOfflineSnapshot(snapshot);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    const world = readField(snapshot, 'wsMaze') || maze;
    const width = Number(readField(world, 'mazeWidth') || WORLD_W), height = Number(readField(world, 'mazeHeight') || WORLD_H);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    drawGround(width, height);
    drawWalls(readField(world, 'mazeWalls') || [], width, height);
    const boxes = readField(snapshot, 'wsMysteryBoxes') || [];
    boxes.forEach(box => { if (readField(box, 'mbActive') !== false) drawBox(readField(box, 'mbPos'), height, box); });
    (readField(snapshot, 'wsLasers') || []).forEach(laser => drawLaser(readField(laser, 'lsStart'), readField(laser, 'lsEnd'), height));
    (readField(snapshot, 'wsBullets') || []).forEach(b => drawBullet(b, height));
    (readField(snapshot, 'wsTanks') || []).forEach(t => drawTank(t, height));
    drawOnlineEffects(height);
    drawVignette(width, height);
    const mineTank = findMyTank(snapshot);
    if (mineTank) drawAmmoHud(tankStats(mineTank), height - 66);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function renderOfflineSnapshot(snapshot) {
    deadTagQueue.length = 0;
    const map = localMap;
    const background = map.background;
    const view = localViewSize();
    if (map.id === 'camdia') {
      drawControlZoneTerrain(map, view);
    } else if (background.complete && background.naturalWidth) {
      const bk = map.zoneScale || 1;   // the zone map is the same picture stretched
      ctx.drawImage(background, camera.x / bk, camera.y / bk, view.width / bk, view.height / bk, 0, 0, WORLD_W, WORLD_H);
    } else {
      ctx.fillStyle = '#172017';
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }
    drawControlZone();
    const boxes = readField(snapshot, 'wsMysteryBoxes') || [];
    boxes.forEach(box => { if (readField(box, 'mbActive') !== false) drawOfflineBox(readField(box, 'mbPos'), box); });
    (readField(snapshot, 'wsBullets') || []).forEach(drawOfflineBullet);
    (readField(snapshot, 'wsTanks') || []).filter(isOfflineTankVisible).forEach(drawOfflineTank);
    drawOfflinePickupEffects();
    drawFogOfWar();
    drawReviveSequence();
    const ammoTank = localGame ? localGame.tanks[0] : (findMyTank(snapshot) || {});
    drawAmmoHud(tankStats(ammoTank), WORLD_H - 66);
    // Dead: the battlefield is turned grey here (not by a CSS filter) so the names can stay blue / red afterwards.
    if (document.body.classList.contains('offline-gray')) {
      ctx.save();
      ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(0, 0, 0, .2)'; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.restore();
      deadTagQueue.forEach(tag => drawNameTag(...tag));
    }
  }

  function drawControlZoneTerrain(map, view) {
    const art = map.art || {};
    const scale = WORLD_W / view.width;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-camera.x, -camera.y);
    ctx.fillStyle = '#4a473e'; ctx.fillRect(0, 0, map.width, map.height);
    const minX = camera.x - 8, minY = camera.y - 8;
    const maxX = camera.x + view.width + 8, maxY = camera.y + view.height + 8;
    (map.terrainPatches || []).forEach(({ key, x, y, size }) => {
      if (x + size < minX || y + size < minY || x > maxX || y > maxY) return;
      const image = art[key];
      if (image && image.complete && image.naturalWidth) {
        // The source tiles are intentionally repeated at a smaller scale, so
        // a camera view contains several real user-provided textures.
        ctx.drawImage(image, x, y, size + 1, size + 1);
      } else {
        ctx.fillStyle = '#48453c'; ctx.fillRect(x, y, size + 1, size + 1);
      }
    });
    // A subdued veil unifies the repeated user-provided terrain tiles without
    // concealing their colour and detail.
    ctx.fillStyle = 'rgba(8,10,8,.12)'; ctx.fillRect(0, 0, map.width, map.height);
    (map.scene || []).forEach(([kind, x, y, size, rotation]) => drawControlZoneProp(art, kind, x, y, size, rotation));
    ctx.restore();
  }

  function drawControlZoneProp(art, kind, x, y, size, rotation = 0) {
    const drawImage = (image, px, py, width, height = width, angle = rotation) => {
      if (!image || !image.complete || !image.naturalWidth) return;
      ctx.save(); ctx.translate(px, py); ctx.rotate(angle); ctx.globalAlpha = .98;
      ctx.drawImage(image, -width / 2, -height / 2, width, height); ctx.restore();
    };
    if (kind === 'rocks') {
      [[-.34,-.22],[0,-.3],[.34,-.2],[-.22,.2],[.18,.24]].forEach(([dx, dy], i) => drawImage(art.rock, x + dx * size, y + dy * size, size * (.46 + (i % 2) * .05)));
      return;
    }
    if (kind === 'bushes') {
      [[-.26,-.15],[.12,-.2],[-.16,.2],[.28,.18]].forEach(([dx, dy], i) => drawImage(art.bush, x + dx * size, y + dy * size, size * (.72 + (i % 2) * .12)));
      return;
    }
    if (kind === 'container') { drawImage(art.container, x, y, size * 1.12, size * .56); return; }
    if (kind === 'ruin') { drawImage(art.ruin, x, y, size, size); return; }
    drawImage(art.tree, x, y, size * .78, size);
  }

  function isOfflineTankVisible(tank) {
    if (readField(tank, 'tankAlive') === false) return false;
    const observer = getOfflineCameraTank();
    if (!observer || readField(tank, 'tankId') === readField(observer, 'tankId')) return true;
    const targetPos = readField(tank, 'tankPos');
    if (!targetPos) return false;
    const observerPos = readField(observer, 'tankPos');
    if (!observerPos) return true;
    if (localGame && localGame.team) {
      return localGame.tanks.some(mate => mate.tankAlive && mate.team === observer.team && distance(mate.tankPos, targetPos) <= visionRadius());
    }
    return distance(observerPos, targetPos) <= visionRadius();
  }

  function getOfflineCameraTank() {
    if (localGame) {
      const player = localGame.tanks[0];
      if (player && player.tankAlive) return player;
      if (localGame.team) {
        const mate = localGame.tanks.find(tank => tank.tankAlive && tank.team === player.team);
        if (mate) return mate;
      }
      return localGame.tanks.find(tank => tank.tankId === localGame.spectatorTankId && tank.tankAlive)
        || localGame.tanks.slice(1).find(tank => tank.tankAlive)
        || null;
    }
    if (mode === 'online' && latestSnapshot) {
      const myTank = findMyTank(latestSnapshot);
      if (myTank && readField(myTank, 'tankAlive') !== false) return myTank;
      const aliveTanks = (readField(latestSnapshot, 'wsTanks') || []).filter(t => readField(t, 'tankAlive') !== false);
      return aliveTanks[0] || myTank || null;
    }
    return null;
  }

  function drawFogOfWar() {
    const observer = getOfflineCameraTank();
    if (!observer) return;
    const screen = localToScreen(observer.tankPos);
    const radius = visionRadius() * localWorldScale();
    if (!Number.isFinite(radius)) return;
    const fogRadius = radius * 1.35;
    const fog = ctx.createRadialGradient(screen.x, screen.y, radius * .88, screen.x, screen.y, fogRadius);
    fog.addColorStop(0, 'rgba(4,9,5,0)');
    fog.addColorStop(.20, 'rgba(4,9,5,0)');
    fog.addColorStop(.64, 'rgba(4,9,5,.20)');
    // The last stop keeps terrain readable while clearly fogging the outer map.
    fog.addColorStop(1, 'rgba(4,9,5,.58)');
    ctx.save();
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.strokeStyle = 'rgba(224,244,193,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawOfflineTank(tank) {
    if (readField(tank, 'tankAlive') === false) return;
    const pos = readField(tank, 'tankPos'); if (!pos) return;
    const screen = localToScreen({ vx: Number(readField(pos, 'vx') || 0), vy: Number(readField(pos, 'vy') || 0) });
    const x = screen.x, y = screen.y;
    const color = COLORS[readField(tank, 'tankColor')] || '#8ae65e';
    const bodyAngle = Number(readField(tank, 'tankBodyAngle') || 0);
    const turretAngle = Number(readField(tank, 'tankTurretAngle') || 0);
    const size = localMap.tankSize * localMap.tankScale * Number(TEST_GAME.tankRenderScale || .5) * localWorldScale();
    ctx.save(); ctx.translate(x, y);
    const invuln = Number(readField(tank, 'tankInvulnerabilityLeft') || 0);
    if (invuln > 0) ctx.globalAlpha = Math.floor(performance.now() / 90) % 2 ? .5 : 1;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(8, 10, size * .33, size * .41, 0, 0, Math.PI * 2); ctx.fill();
    // Enemy tanks get a red marker under their feet (allies and you are not marked).
    if (sideOf(String(readField(tank, 'tankId') || '')) === 'enemy') {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 50, 50, .28)';
      ctx.strokeStyle = 'rgba(255, 70, 60, .95)';
      ctx.lineWidth = Math.max(2, size * .035);
      ctx.beginPath(); ctx.arc(0, 0, size * .42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    const sprites = spritesFor(readField(tank, 'tankId'));
    const hull = sprites.hull;
    if (hull && hull.complete && hull.naturalWidth) {
      ctx.save(); ctx.rotate(bodyAngle + Math.PI / 2); drawTinted(hull, color, -size / 2, -size / 2, size, size); ctx.restore();
    } else {
      ctx.fillStyle = color; ctx.fillRect(-size * .29, -size * .38, size * .58, size * .76);
    }
    const gun = sprites.gun;
    if (gun && gun.complete && gun.naturalWidth) {
      drawTankGunSprite(gun, color, turretAngle, size, size);
    }
    if (invuln > 0) { ctx.globalAlpha = 1; drawShield(size * .5); }
    ctx.restore();
    const tagId = String(readField(tank, 'tankId') || ''), tagSide = sideOf(tagId);
    const tagArgs = [x, y - size * .5 - 4, tagId, tagSide === 'me' ? '#f9df8b' : tagSide === 'ally' ? '#7cc0ff' : '#ff8a80'];
    if (document.body.classList.contains('offline-gray')) deadTagQueue.push(tagArgs); else drawNameTag(...tagArgs);
  }

  const deadTagQueue = [];   // name tags drawn after the grey-out while the player is dead
  // Player name above a tank: gold = you, blue = ally, red = enemy.
  function drawNameTag(x, y, name, color) {
    if (!name) return;
    const text = name.length > 14 ? `${name.slice(0, 13)}…` : name;
    ctx.save();
    ctx.font = '700 12px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0, 0, 0, .75)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawShield(radius) {
    const pulse = .5 + .5 * Math.sin(performance.now() / 55);
    ctx.save();
    ctx.globalAlpha = .35 + .45 * pulse;
    ctx.strokeStyle = '#8be9ff'; ctx.fillStyle = 'rgba(120,225,255,.16)';
    ctx.shadowColor = '#8be9ff'; ctx.shadowBlur = 14; ctx.lineWidth = Math.max(2, radius * .06);
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function bulletColor(type) {
    return type === 'LaserBullet' ? '#82f9ff' : type === 'ShotgunBullet' ? '#ffca73' : type === 'WallPiercingBullet' ? '#c39aff' : type === 'GatlingBullet' ? '#ff9658' : '#e6efc4';
  }

  function drawProjectileArt(type, x, y, angle, size) {
    const frames = bulletEffectFrames[type];
    if (!frames || !frames.length) return false;
    const frame = frames[Math.floor(performance.now() / 68) % frames.length];
    if (!frame.complete || !frame.naturalWidth) return false;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(frame, -size / 2, -size / 2, size, size);
    ctx.restore();
    return true;
  }

  function drawBulletCore(type, x, y, radius) {
    const color = bulletColor(type);
    ctx.save();
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // The supplied effect PNGs have generous transparent borders.  Rendering
  // them at their raw canvas size made a Mystery Box projectile look like a
  // one-pixel ray.  This converts the sprite canvas to a visible projectile
  // about the size of the tank's standard round at the current camera zoom.
  function specialProjectileArtSize(type, coreRadius) {
    const multiplier = type === 'LaserBullet' || type === 'WallPiercingBullet' ? 21
      : type === 'GatlingBullet' ? 18 : 15;
    return Math.max(36, coreRadius * multiplier);
  }

  function drawOfflineBullet(bullet) {
    const pos = readField(bullet, 'bulPos'); if (!pos) return;
    const type = readField(bullet, 'bulType') || 'NormalBullet';
    const screen = localToScreen({ vx: Number(readField(pos, 'vx') || 0), vy: Number(readField(pos, 'vy') || 0) });
    const radius = Math.max(2, (type === 'ShotgunBullet' ? 9 : 7) * localWorldScale());
    const velocity = readField(bullet, 'bulVel') || {};
    const angle = Math.atan2(Number(readField(velocity, 'vy') || 0), Number(readField(velocity, 'vx') || 0));
    if (type === 'NormalBullet') { drawBulletCore(type, screen.x, screen.y, radius); return; }
    // Keep a full-size glowing core behind the artwork so every special shot
    // remains as readable as a normal tank round, even in a sparse frame.
    drawBulletCore(type, screen.x, screen.y, radius);
    drawProjectileArt(type, screen.x, screen.y, angle, specialProjectileArtSize(type, radius));
  }

  function localTankRenderSize() {
    return localMap ? localMap.tankSize * localMap.tankScale * Number(TEST_GAME.tankRenderScale || .5) * localWorldScale() : 72;
  }

  function boxMotion(box) {
    const spawnedAt = box ? Number(box.spawnedAt ?? readField(box, 'mbSpawnedAt') ?? 0) : 0;
    const age = mode === 'offline' && localGame ? localGame.time - spawnedAt : performance.now() / 1000;
    return { scale: 1 + .09 * Math.sin(age * 7), shakeX: Math.sin(age * 19) * 2.4, shakeY: Math.cos(age * 23) * 1.6 };
  }

  function drawOfflineBox(pos, box) {
    if (!pos) return;
    const screen = localToScreen({ vx: Number(readField(pos, 'vx') || 0), vy: Number(readField(pos, 'vy') || 0) });
    const motion = boxMotion(box), x = screen.x + motion.shakeX, y = screen.y + motion.shakeY;
    const size = 112 * localWorldScale() * motion.scale;
    const image = images.box;
    ctx.save(); ctx.shadowColor = '#f3d466'; ctx.shadowBlur = 24;
    if (image && image.complete && image.naturalWidth) ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
    else { ctx.fillStyle = '#e1bc4e'; ctx.fillRect(x - size * .4, y - size * .4, size * .8, size * .8); ctx.fillStyle = '#132013'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', x, y + 4); }
    ctx.restore();
  }

  function drawItemEffect(effect, x, y, size) {
    const fade = clamp(effect.life / effect.duration, 0, 1);
    ctx.save(); ctx.globalAlpha = Math.min(1, fade * 1.5);
    if (effect.kind === 'boxBroken') {
      const image = images.boxBroken;
      if (image && image.complete && image.naturalWidth) ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
    } else if (effect.kind === 'weapon') {
      drawProjectileArt(effect.reward, x, y, -Math.PI / 2, size * .66);
    } else if (effect.reward === 'bomb') {
      const image = images.rewardBomb;
      if (image && image.complete && image.naturalWidth) ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
    } else if (effect.reward === 'shield') {
      const image = images.rewardShield;
      if (image && image.complete && image.naturalWidth) ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
    } else if (effect.reward === 'power') {
      const pulse = 1 + .12 * Math.sin(performance.now() / 75);
      ctx.strokeStyle = '#ffe778'; ctx.shadowColor = '#ffe778'; ctx.shadowBlur = 16; ctx.lineWidth = Math.max(2, size * .05);
      ctx.beginPath(); ctx.arc(x, y, size * .28 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff0a6'; ctx.font = `800 ${Math.max(10, size * .16)}px "Barlow Condensed", sans-serif`; ctx.textAlign = 'center'; ctx.fillText('POWER', x, y + size * .06);
    }
    ctx.restore();
  }

  function drawOfflinePickupEffects() {
    const g = localGame; if (!g) return;
    const size = localTankRenderSize() * 1.25;
    g.effects.forEach(effect => {
      const point = localToScreen(effect.pos);
      drawItemEffect(effect, point.x, point.y, size);
    });
  }

  function drawReviveSequence() {
    const sequence = localGame && localGame.heartSequence;
    if (!sequence || !heartFrames.length) return;
    const elapsed = sequence.duration - sequence.life;
    const frame = heartFrames[Math.floor(elapsed / .16) % heartFrames.length];
    if (!frame.complete || !frame.naturalWidth) return;
    const size = localTankRenderSize();
    const pulse = 1 + .12 * Math.sin(elapsed * 12);
    ctx.save(); ctx.globalAlpha = Math.min(1, sequence.life * 2); ctx.shadowColor = '#ff5d78'; ctx.shadowBlur = 18;
    ctx.drawImage(frame, WORLD_W / 2 - size * pulse / 2, WORLD_H / 2 - size * pulse / 2, size * pulse, size * pulse);
    ctx.restore();
  }

  // Bottom-left ammo counter (digit sprites) or the reload spinner. Works for both modes.
  function drawAmmoHud(stats, y) {
    if (!stats || !stats.hasAmmo || !stats.alive) return;
    const x = 20;
    if (stats.reload > 0) {
      const frame = 1 + Math.floor(performance.now() / 83) % 8;
      const image = hudImages[`loading-${frame}`];
      if (image && image.complete && image.naturalWidth) ctx.drawImage(image, x, y, 56, 56);
      return;
    }
    String(Math.max(0, Math.floor(stats.ammo))).split('').forEach((digit, index) => {
      const image = hudImages[`digit-${digit}`];
      if (image && image.complete && image.naturalWidth) ctx.drawImage(image, x + index * 37, y, 34, 52);
    });
  }

  // Online renderer (server world, Y axis points up so every y is flipped with `height`).
  function drawGround(w = WORLD_W, h = WORLD_H) {
    ctx.fillStyle = '#1d3020'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(126,163,100,.04)';
    const tileSize = 32;
    for (let y = 0; y < h; y += tileSize) {
      for (let x = 0; x < w; x += tileSize) {
        if (((Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2) === 0) ctx.fillRect(x, y, tileSize, tileSize);
      }
    }
    ctx.strokeStyle = 'rgba(167,205,137,.08)'; ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += tileSize) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += tileSize) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    // Subtle worn ground flecks
    const dotCount = Math.floor((w * h) / 10000);
    for (let i = 0; i < dotCount; i++) {
      const x = (i * 157 + 33) % w, y = (i * 97 + 19) % h;
      ctx.fillStyle = 'rgba(182,208,143,.045)'; ctx.fillRect(x, y, 2, 2);
    }
  }

  function drawWalls(walls, width, height) {
    ctx.save(); ctx.lineCap = 'square';
    (walls || []).forEach((wall, index) => {
      const a = readField(wall, 'wallStart'), b = readField(wall, 'wallEnd'); if (!a || !b) return;
      const x1 = Number(readField(a, 'vx') || 0), y1 = height - Number(readField(a, 'vy') || 0);
      const x2 = Number(readField(b, 'vx') || 0), y2 = height - Number(readField(b, 'vy') || 0);
      ctx.strokeStyle = 'rgba(5,11,7,.55)'; ctx.lineWidth = index < 4 ? 15 : 12; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = index < 4 ? '#68815b' : '#58704d'; ctx.lineWidth = index < 4 ? 10 : 8; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(207,232,171,.18)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x1 + (x2 - x1) * .04, y1 + (y2 - y1) * .04 - 1); ctx.lineTo(x2 - (x2 - x1) * .04, y2 - (y2 - y1) * .04 - 1); ctx.stroke();
      // Small rivets on straight wall runs.
      const len = Math.hypot(x2 - x1, y2 - y1), n = Math.floor(len / 24);
      for (let j = 1; j < n; j++) { const x = x1 + (x2 - x1) * j / n, y = y1 + (y2 - y1) * j / n; ctx.fillStyle = '#344633'; ctx.fillRect(x - 1, y - 1, 2, 2); }
    });
    ctx.restore();
  }

  function drawTank(tank, height) {
    if (readField(tank, 'tankAlive') === false) return;
    const pos = readField(tank, 'tankPos'); if (!pos) return;
    const x = Number(readField(pos, 'vx') || 0), y = height - Number(readField(pos, 'vy') || 0);
    const colorName = readField(tank, 'tankColor') || 'TankGreen';
    const color = COLORS[colorName] || '#8ae65e';
    const bodyAngle = Number(readField(tank, 'tankBodyAngle') || 0), turretAngle = Number(readField(tank, 'tankTurretAngle') || 0);
    ctx.save(); ctx.translate(x, y);
    const invulnOnline = Number(readField(tank, 'tankInvulnerabilityLeft') || 0);
    if (invulnOnline > 0) drawShield(26);
    ctx.strokeStyle = color; ctx.globalAlpha = .6; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 21, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    // Shadow then the reused project sprite. If images fail, draw a vector tank instead.
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(2, 4, 15, 19, 0, 0, Math.PI * 2); ctx.fill();
    const sprites = spritesFor(readField(tank, 'tankId'));
    const hull = sprites.hull;
    if (hull && hull.complete && hull.naturalWidth) {
      ctx.save(); ctx.rotate(Math.PI / 2 - bodyAngle); drawTinted(hull, color, -11, -18, 22, 36); ctx.restore();
    } else drawVectorHull(color, bodyAngle);
    const gun = sprites.gun;
    if (gun && gun.complete && gun.naturalWidth) {
      // `drawTankGunSprite` uses the offline rotation convention.  Reuse its
      // scale here while retaining the inverted-Y rotation used by snapshots.
      const scale = GUN_RENDER_SCALE;
      ctx.save(); ctx.rotate(Math.PI / 2 - turretAngle); drawTinted(gun, color, -7 * scale, -18 * scale, 14 * scale, 36 * scale); ctx.restore();
    }
    else { ctx.save(); ctx.rotate(-turretAngle); ctx.fillStyle = color; ctx.fillRect(-3, -22, 6, 24); ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    ctx.restore();
    const onlineName = String(readField(tank, 'tankId') || '');
    drawNameTag(x, y - 26, onlineName, isMe(onlineName) ? '#f9df8b' : '#e8f0df');
  }

  function drawTinted(img, color, x, y, w, h) {
    // Keep the supplied sprite intact; color overlays created opaque rectangles.
    ctx.drawImage(img, x, y, w, h);
  }
  function drawVectorHull(color, angle) { ctx.save(); ctx.rotate(Math.PI / 2 - angle); ctx.fillStyle = '#1c2921'; ctx.fillRect(-10, -17, 20, 34); ctx.fillStyle = color; ctx.fillRect(-7, -15, 14, 30); ctx.fillStyle = '#101811'; ctx.fillRect(-3, -11, 6, 20); ctx.restore(); }

  function drawBullet(b, height) {
    const pos = readField(b, 'bulPos'); if (!pos) return; const type = readField(b, 'bulType') || 'NormalBullet';
    const x = Number(readField(pos, 'vx') || 0), y = height - Number(readField(pos, 'vy') || 0);
    const velocity = readField(b, 'bulVel') || {};
    const angle = Math.atan2(-Number(readField(velocity, 'vy') || 0), Number(readField(velocity, 'vx') || 0));
    const radius = type === 'ShotgunBullet' ? 3.5 : 3;
    if (type === 'NormalBullet') { drawBulletCore(type, x, y, radius); return; }
    // Online snapshots use the same readable size as offline Mystery Box
    // rounds, rather than the tiny raw effect sprite.
    drawBulletCore(type, x, y, radius);
    drawProjectileArt(type, x, y, angle, specialProjectileArtSize(type, radius));
  }
  function drawBox(pos, height = WORLD_H, box = null) {
    if (!pos) return; const x = Number(readField(pos, 'vx') || 0), y = height - Number(readField(pos, 'vy') || 0);
    const im = images.box;
    const motion = boxMotion(box), size = 56 * motion.scale;
    ctx.save(); ctx.shadowColor = '#e8c95a'; ctx.shadowBlur = 18;
    if (im && im.complete && im.naturalWidth) { ctx.drawImage(im, x + motion.shakeX - size / 2, y + motion.shakeY - size / 2, size, size); } else { ctx.fillStyle = '#d3aa42'; ctx.fillRect(x - 22, y - 22, 44, 44); ctx.fillStyle = '#1c281b'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', x, y + 6); }
    ctx.restore();
  }

  function queueOnlineBoxEffects(picker, reward) {
    const tank = latestSnapshot && (readField(latestSnapshot, 'wsTanks') || []).find(item => String(readField(item, 'tankId') || '') === picker);
    const pos = tank && readField(tank, 'tankPos'); if (!pos) return;
    const point = { vx: Number(readField(pos, 'vx') || 0), vy: Number(readField(pos, 'vy') || 0) };
    const expires = performance.now() + 2000;
    onlineEffects.push({ kind: 'boxBroken', pos: point, owner: '', reward: '', expires, duration: 2000 });
    onlineEffects.push({ kind: 'weapon', pos: point, owner: picker, reward, expires, duration: 2000 });
  }

  function drawOnlineEffects(height) {
    const now = performance.now();
    const tanks = latestSnapshot ? (readField(latestSnapshot, 'wsTanks') || []) : [];
    onlineEffects = onlineEffects.filter(effect => effect.expires > now && (!effect.owner || tanks.some(tank => String(readField(tank, 'tankId') || '') === effect.owner && readField(tank, 'tankAlive') !== false)));
    onlineEffects.forEach(effect => {
      const life = Math.max(0, (effect.expires - now) / 1000);
      drawItemEffect({ ...effect, life, duration: effect.duration / 1000 }, Number(effect.pos.vx), height - Number(effect.pos.vy), 54);
    });
  }
  function drawLaser(a, b, height) { if (!a || !b) return; const x1 = Number(readField(a, 'vx') || 0), y1 = height - Number(readField(a, 'vy') || 0), x2 = Number(readField(b, 'vx') || 0), y2 = height - Number(readField(b, 'vy') || 0); ctx.save(); ctx.strokeStyle = '#89faff'; ctx.shadowColor = '#89faff'; ctx.shadowBlur = 12; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore(); }
  function drawVignette(w = WORLD_W, h = WORLD_H) { const grad = ctx.createRadialGradient(w / 2, h / 2, 80, w / 2, h / 2, Math.max(w, h) * .75); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(4,10,5,.33)'); ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h); }

  // ---------------------------------------------------------------- HUD

  function updateMatchHeader(snapshot) {
    if (!snapshot) return;
    const tanks = readField(snapshot, 'wsTanks') || [];
    const mine = tanks.find(t => readField(t, 'tankId') === username) || tanks.find(t => readField(t, 'tankId') === displayName) || tanks[0];
    $('match-player-count').textContent = String(tanks.length || 1);
    $('match-score').textContent = String(mine ? tankStats(mine).points : 0);
    if (mode === 'online' && activeRoom) $('match-room').textContent = readField(activeRoom, 'riRoomId') || 'ONLINE';
  }
  // Normalises a Tank (server snapshot or local simulation) into plain numbers for the HUD.
  function tankStats(tank) {
    const num = (key, fallback = 0) => { const v = Number(readField(tank, key)); return Number.isFinite(v) ? v : fallback; };
    const kills = num('tankKills');
    const hasPoints = readField(tank, 'tankPoints') !== undefined;
    return {
      id: String(readField(tank, 'tankId') || 'PLAYER'),
      color: readField(tank, 'tankColor') || 'TankGreen',
      alive: readField(tank, 'tankAlive') !== false,
      kills, deaths: num('tankDeaths'),
      points: hasPoints ? num('tankPoints') : kills,
      streak: num('tankKillStreak'),
      respawn: num('tankRespawnTimer'), respawnKnown: readField(tank, 'tankRespawnTimer') !== undefined,
      invuln: num('tankInvulnerabilityLeft'), team: num('tankTeam', -1),
      hasAmmo: readField(tank, 'tankAmmo') !== undefined,
      ammo: num('tankAmmo'), maxAmmo: num('tankMaxAmmo', RULES.magazineSize), reload: num('tankReloadTimer')
    };
  }

  function findMyTank(snapshot) {
    const tanks = readField(snapshot, 'wsTanks') || [];
    return tanks.find(t => readField(t, 'tankId') === username) || tanks.find(t => readField(t, 'tankId') === displayName) || tanks[0] || null;
  }

  function isMe(name) { return !!name && (name === username || name === displayName); }

  function scoreboardEntries(snapshot) {
    const entries = (readField(snapshot, 'wsTanks') || []).map(tankStats);
    // Fallback rows (e.g. the round-end payload carries only name/score pairs).
    (readField(snapshot, 'wsScores') || []).forEach(pair => {
      if (!Array.isArray(pair) || entries.some(e => e.id === pair[0])) return;
      entries.push({ id: String(pair[0]), color: 'TankBlue', alive: true, kills: 0, deaths: 0, points: Number(pair[1] || 0), streak: 0, respawn: 0, invuln: 0 });
    });
    // Team mode: your team is listed first.
    const myTeam = (entries.find(e => isMe(e.id)) || {}).team;
    const side = e => e.team < 0 || e.team === myTeam ? 0 : 1;
    entries.sort((a, b) => side(a) - side(b) || b.points - a.points || b.kills - a.kills || a.deaths - b.deaths);
    return entries;
  }

  function updateScoreboard(snapshot) {
    const root = $('scoreboard'); root.innerHTML = ''; if (!snapshot) return;
    const entries = scoreboardEntries(snapshot);
    if (!entries.length) { root.innerHTML = '<div class="feed-item muted">Đang đợi dữ liệu người chơi…</div>'; return; }
    entries.forEach(e => {
      const row = document.createElement('div'); row.className = 'score-row';
      const dot = document.createElement('span'); dot.className = 'score-dot'; dot.style.background = COLORS[e.color] || '#c7f36b';
      const name = document.createElement('span'); name.className = 'score-name';
      name.textContent = `${e.id} · ${e.kills}/${e.deaths}${e.alive ? '' : (e.team >= 0 ? ' · ĐÃ HẠ' : ' · CHỜ')}`;
      const score = document.createElement('strong'); score.className = 'score-value'; score.textContent = String(e.points);
      row.append(dot, name, score); root.append(row);
    });
  }

  function updateWeaponPanel(snapshot) {
    if (!snapshot || !$('weapon-name')) return; const tanks = readField(snapshot, 'wsTanks') || [];
    const mine = tanks.find(t => readField(t, 'tankId') === username) || tanks.find(t => readField(t, 'tankId') === displayName) || tanks[0]; if (!mine) return;
    const weapon = readField(mine, 'tankWeapon') || {}; const type = readField(weapon, 'wsCurrentWeapon') || 'NormalBullet';
    const buff = Number(readField(weapon, 'wsBuffTimeLeft') || 0); const cooldown = readField(weapon, 'wsCooldownState');
    if ($('weapon-name')) $('weapon-name').textContent = weaponName(type).toUpperCase();
    if ($('weapon-symbol')) $('weapon-symbol').textContent = weaponSymbol(type);
    if ($('weapon-timer')) $('weapon-timer').textContent = buff > 0 ? `BUFF CÒN ${buff.toFixed(1)}S` : cooldown === 'Ready' || tagOf(cooldown) === 'Ready' ? 'SẴN SÀNG' : 'ĐANG HỒI ĐẠN';
    let ratio = 1; if (typeof cooldown === 'object' && cooldown) { const tag = tagOf(cooldown); if (tag === 'Reloading') { const v = Array.isArray(cooldown.contents) ? cooldown.contents[0] : cooldown.contents; const maxCooldown = type === 'NormalBullet' ? 0.5 : 1.0; ratio = 1 - clamp(Number(v || 0) / maxCooldown, 0, 1); } else if (tag === 'GatlingBurst') { ratio = .65; } }
    const st = tankStats(mine);
    if (st.hasAmmo && st.reload > 0) {
      ratio = 1 - clamp(st.reload / RULES.reloadSeconds, 0, 1);
      if ($('weapon-timer')) $('weapon-timer').textContent = `ĐANG NẠP ĐẠN ${st.reload.toFixed(1)}S`;
    }
    if ($('cooldown-fill')) $('cooldown-fill').style.width = `${Math.round(ratio * 100)}%`;
  }
  function weaponName(type) { return ({ NormalBullet: 'Đạn thường', ShotgunBullet: 'Đạn chùm', LaserBullet: 'Tia laser', WallPiercingBullet: 'Đạn xuyên tường', GatlingBullet: 'Đạn liên thanh' })[type] || String(type || 'Đạn thường').replace('Bullet', ''); }
  function weaponSymbol(type) { return ({ NormalBullet: '●', ShotgunBullet: '✹', LaserBullet: 'ϟ', WallPiercingBullet: '↗', GatlingBullet: '»' })[type] || '●'; }
  function addFeed(text, type = '') { const root = $('event-feed'); if (!root) return; const row = document.createElement('div'); row.className = `feed-item ${type}`; const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); row.textContent = `[${time}] ${text}`; root.prepend(row); while (root.children.length > 8) root.lastElementChild.remove(); }

  // ---------------------------------------------------------------- gameplay HUD (K/D, score, kill feed, banners)

  function setText(id, value) {
    const el = $(id);
    const text = String(value);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function matchSeconds() {
    if (mode === 'offline') return localGame ? (localGame.team && !localGame.zone ? localGame.roundClock : localGame.time) : 0;
    if (mode === 'online' && latestSnapshot) { const c = Number(readField(latestSnapshot, 'wsClock')); if (Number.isFinite(c)) return c; }
    return matchClockStart ? (performance.now() - matchClockStart) / 1000 : 0;
  }

  function matchLimitSeconds() {
    if (mode === 'online' && latestSnapshot) { const lim = Number(readField(latestSnapshot, 'wsClockLimit')); return lim > 0 ? lim : Infinity; }
    return mode === 'offline' && localGame && localGame.zone ? Infinity : mode === 'offline' && localGame && localGame.team ? botSettings.teamRoundSeconds : botSettings.matchSeconds;
  }

  function resetMatchUi() {
    killTracker.clear(); streakTracker.clear(); lastKnownStreak.clear();
    lastKillerOfMe = ''; myDeathAt = 0; myWasAlive = true;
    matchClockStart = performance.now();
    document.body.classList.remove('player-dead', 'offline-gray');
    lastClockBeep = null; lastCountdownSecond = null; minuteWarnKey = null; countdownActive = false; matchPointActive = false; zoneBoostActive = false; matchPointChoice = null; firstBloodDone = false; hideEndSplash(); removeCountdownOverlay(); stopCountdownSound();
    onlineEffects = [];
    resetAnnouncements();
    const feed = $('kill-feed'); if (feed) feed.innerHTML = '';
    clearTimeout(bannerTimer);
    ['kill-banner', 'respawn-banner', 'shield-chip'].forEach(id => { const el = $(id); if (el) el.hidden = true; });
    showTabScoreboard(false);
    stopShotSounds();
  }

  // Online only: remember who was alive with which streak, and when we died (client-side respawn fallback).
  function trackSnapshot(snapshot) {
    if (!snapshot) return;
    (readField(snapshot, 'wsTanks') || []).forEach(tank => {
      const st = tankStats(tank);
      if (st.alive) lastKnownStreak.set(st.id, st.streak);
      if (isMe(st.id)) {
        if (myWasAlive && !st.alive) myDeathAt = performance.now();
        myWasAlive = st.alive;
      }
    });
  }

  function updateGameplayHud(snapshot) {
    if (!snapshot) return;
    const me = findMyTank(snapshot); if (!me) return;
    const st = tankStats(me);
    // Dead: the whole battlefield turns grey (like LoL / AOV) until you are back in the fight.
    const fighting = screenName === 'game' && !(mode === 'offline' && localGame && (localGame.gameOver || localGame.awaitingNext || localGame.startCountdown > 0));
    document.body.classList.toggle('player-dead', fighting && !st.alive);
    document.body.classList.toggle('offline-gray', screenName === 'game' && !st.alive);
    setText('kda-kills', st.kills);
    setText('kda-deaths', st.deaths);
    setText('kda-points', `SCORE: ${st.points}`);
    const streak = $('kda-streak');
    if (streak) { streak.hidden = st.streak < 1; setText('kda-streak', `CHUỖI: ${st.streak}`); }
    const hg = hudGame();
    const zoneClock = !!hg && !!hg.zone;   // control zone: no time limit, the clock counts up like the zone timer
    const remainingMatch = zoneClock ? Infinity : Math.max(0, matchLimitSeconds() - matchSeconds());
    setText('match-clock', zoneClock ? formatClock(hg.zone.elapsed) : formatClock(Math.ceil(remainingMatch)));
    const clockEl = $('match-clock');
    if (clockEl) clockEl.classList.toggle('low', remainingMatch <= 30);
    // One-minute warning: the moment the clock reads 1:00 the banner shows at once and the 1mincountdown soundtrack
    // replaces the match music, looping until the match ends. Team mode does the same in every round.
    const warnKey = mode === 'offline' && localGame && localGame.team ? `r${localGame.round}` : 'match';
    const inPlay = !(mode === 'offline' && localGame && (localGame.gameOver || localGame.roundOver));
    if (matchLimitSeconds() > 60 && remainingMatch > 0 && remainingMatch <= 60 && minuteWarnKey !== warnKey && inPlay) {
      minuteWarnKey = warnKey;
      showKillBanner('1 MINUTE LEFT', 'FIGHT TILL THE END. DONT GIVE UP YET.', 'minute', 'TIME WARNING', 5000);
    }
    const shouldCount = minuteWarnKey === warnKey && remainingMatch > 0 && inPlay && !countdownBroken && screenName === 'game';
    if (shouldCount !== countdownActive) { countdownActive = shouldCount; syncMusicForScreen(); }
    const wholeLeft = Math.ceil(remainingMatch);
    if (remainingMatch > 0 && wholeLeft <= 5 && wholeLeft !== lastClockBeep) { lastClockBeep = wholeLeft; }

    const respawnBanner = $('respawn-banner');
    if (respawnBanner) {
      const teamMode = mode === 'offline' && !!localGame && localGame.team && !localGame.zone;   // control zone mode respawns after 5 s
      let remaining = 0;
      if (!st.alive) remaining = st.respawnKnown ? st.respawn : Math.max(0, RULES.respawnSeconds - (performance.now() - myDeathAt) / 1000);
      // Team mode has no respawn: the panel stays until the next round starts.
      respawnBanner.hidden = teamMode ? (st.alive || localGame.awaitingNext || localGame.gameOver) : !(!st.alive && remaining > 0);
      respawnBanner.classList.toggle('team', teamMode);
      if (!respawnBanner.hidden) {
        setText('respawn-by', lastKillerOfMe ? `${lastKillerOfMe} đã hạ bạn` : 'BẠN ĐÃ BỊ HẠ');
        setText('respawn-count', teamMode ? '✖' : remaining.toFixed(1));
        const labelEl = respawnBanner.querySelector('.respawn-label');
        const labelText = teamMode ? 'CHỜ ROUND SAU · ĐANG XEM ĐỒNG ĐỘI' : 'GIÂY ĐỂ HỒI SINH';
        if (labelEl && labelEl.textContent !== labelText) labelEl.textContent = labelText;
      }
    }
    const chip = $('shield-chip');
    if (chip) {
      chip.hidden = !(st.alive && st.invuln > 0);
      if (!chip.hidden) setText('shield-time', `${st.invuln.toFixed(1)}s`);
    }
    if (tabHeld) renderTabScoreboard(snapshot);
  }

  function colorOfTank(name) {
    const tanks = latestSnapshot ? (readField(latestSnapshot, 'wsTanks') || []) : [];
    const tank = tanks.find(t => readField(t, 'tankId') === name);
    return COLORS[tank ? readField(tank, 'tankColor') : ''] || '#e8f0df';
  }

  function parseTier(value) {
    if (typeof value === 'number') return clamp(Math.floor(value), 0, 5);
    const text = String(tagOf(value) || value || '').toLowerCase();
    if (text.includes('penta')) return 5;
    if (text.includes('quadra')) return 4;
    if (text.includes('triple')) return 3;
    if (text.includes('double')) return 2;
    if (text.includes('slain') || text.includes('single')) return 1;
    return 0;
  }

  function handleOnlineKillEvent(values) {
    const killer = String(values[0] || 'Ai đó'), victim = String(values[1] || 'đối thủ');
    const now = performance.now();
    const hasTier = values[2] !== undefined && values[2] !== null;
    let tier = hasTier ? Math.max(1, parseTier(values[2])) : 0;
    if (!tier) {
      // Backend did not send a multi-kill level: count kills inside the time window here.
      const record = killTracker.get(killer);
      const count = record && now - record.last <= RULES.multiKillWindow * 1000 ? record.count + 1 : 1;
      killTracker.set(killer, { count, last: now });
      tier = Math.min(count, 5);
    }
    const shutdown = values[3] !== undefined && values[3] !== null
      ? (values[3] === true || Number(values[3]) > 0)
      : (lastKnownStreak.get(victim) || 0) >= RULES.streakStart;
    const hasStreak = values[4] !== undefined && values[4] !== null;
    const streak = hasStreak ? Number(values[4]) || 0 : (streakTracker.get(killer) || 0) + 1;
    streakTracker.set(killer, streak);
    streakTracker.delete(victim);
    killTracker.delete(victim);
    lastKnownStreak.set(victim, 0);
    announceKill({ killer, victim, tier, streak, shutdown, points: RULES.killPoints + (shutdown ? RULES.shutdownBonus : 0) });
  }

  // 'me' | 'ally' (team mode only) | 'enemy'
  function sideOf(name) {
    if (isMe(name)) return 'me';
    if (mode === 'offline' && localGame && localGame.team) {
      const tank = localGame.tanks.find(t => t.tankId === name);
      if (tank && tank.team === localGame.tanks[0].team) return 'ally';
    }
    if (mode === 'online' && onlineDraft && onlineDraft.teams && onlineDraft.teams[username]) {
      const myTeam = onlineDraft.teams[username];
      if (onlineDraft.teams[name] === myTeam) return 'ally';
    }
    return 'enemy';
  }

  // One entry point for a kill, used by the local simulation and by SKillEvent.
  function announceKill({ killer, victim, tier = 1, streak = 0, shutdown = false, points = RULES.killPoints }) {
    // Once the match is over (results screen) there are no more kill notifications.
    if (screenName !== 'game' || (mode === 'offline' && localGame && localGame.gameOver)) return;
    const mineKiller = isMe(killer), mineVictim = isMe(victim);
    const killerSide = sideOf(killer), victimSide = sideOf(victim);
    if (mineVictim) lastKillerOfMe = killer;
    // 3+ kills in a row without dying, but spread out too far to count as a multi-kill: Ultimate ... Legendary (7+).
    const streakTier = tier < 2 && streak >= 3 ? Math.min(streak, 7) : 0;
    const firstBlood = !firstBloodDone;
    firstBloodDone = true;
    pushKillFeed({ killer, victim, tier, streakTier, shutdown, points, firstBlood, mine: mineKiller || mineVictim });
    addFeed(`${killer} hạ ${victim}${tier >= 2 ? ` · ${MULTI_TITLES[tier]}` : ''}${shutdown ? ` · SHUTDOWN +${RULES.shutdownBonus}` : ''}`, 'warn');
    const who = mineKiller ? 'Bạn' : killer;
    const enemy = killerSide === 'enemy';   // team mode: allies use the normal voices, only real enemies use enemy_*
    const tag = title => title;   // no "ENEMY" prefix: enemy banners are told apart by colour
    // Only the announcements this kill really earns are queued; they play one after another (banner + voice):
    //   - FIRST BLOOD (firstblood.mp3, shared by you and the enemy): shown first, alone (no slain / defeated)
    //   - Double / Triple / Quadra / Penta kill, or Ultimate ... Legendary: only that title + its own voice
    //   - SHUTDOWN (shutdown.mp3): only the shutdown banner + voice (no "ENEMY" prefix, no defeated)
    //   - a plain kill with none of the above: slain.mp3 (you kill an enemy) / defeated.mp3 (an enemy kills you) / enemy_defeated.mp3 (an enemy kills an enemy)
    // Being killed is shown by the respawn countdown panel, so there is no SLAIN-style banner for that.
    // AOV style alert: First Blood has its own; otherwise ally_kill (you / an ally kills an enemy) or enemy_kill (anything else).
    let alertKey = firstBlood ? 'firstBloodAlert' : (killerSide === 'enemy' ? 'enemyKillAlert' : 'allyKillAlert');
    const queueAnnouncement = item => { if (alertKey) { item.alert = alertKey; alertKey = null; } queueAnnouncementBase(item); };   // only the first item of a kill carries it
    const vol = mineKiller ? .85 : .7;
    const special = firstBlood || tier >= 2 || streakTier || shutdown;
    if (firstBlood) queueAnnouncement({ banner: [tag('FIRST BLOOD'), `${who} đã hạ ${victim}`, `firstblood${enemy ? ' enemy' : ''}`, 'FIRST BLOOD', 3000], voice: 'firstBlood', vol, fallback: () => playKillSting(1, true) });
    if (tier >= 2) queueAnnouncement({ banner: [tag(MULTI_TITLES[tier]), `${who} đã hạ ${victim}`, `multi-${tier}${enemy ? ' enemy' : ''}`, 'MULTI KILL', tier >= 5 ? 3600 : 2800], voice: voiceKey(MULTI_SOUNDS[tier], enemy), vol, fallback: () => playKillSting(tier) });
    else if (streakTier) queueAnnouncement({ banner: [tag(STREAK_TITLES[streakTier]), `${who} đã hạ ${victim} · chuỗi ${streak} mạng`, `streak-${streakTier}${enemy ? ' enemy' : ''}`, 'KILLING SPREE', streakTier >= 7 ? 3400 : 2800], voice: voiceKey(STREAK_SOUNDS[streakTier], enemy), vol, fallback: () => playKillSting(Math.min(5, streakTier)) });
    if (shutdown) queueAnnouncement({ banner: ['SHUTDOWN', `${who} đã chấm dứt chuỗi của ${victim} · +${RULES.shutdownBonus}`, `shutdown${enemy ? ' enemy' : ''}`, 'SHUTDOWN', 2800], voice: 'shutdown', vol, fallback: () => playKillSting(1, true) });
    const teamVoices = mode === 'offline' && !!localGame && !!localGame.team;
    if (!special && teamVoices) {
      // Team modes: the voice depends on which side scored. The banner for my own kill is unchanged.
      const ourSideScored = killerSide !== 'enemy';
      // enemy kills ME -> defeated; enemy kills an ALLY -> ally_defeated; our side kills an enemy -> enemy_defeated
      const voice = ourSideScored ? 'enemyDefeated' : mineVictim ? 'defeated' : 'allyDefeated';
      if (mineKiller) queueAnnouncement({ banner: ['SLAIN', `Bạn đã hạ ${victim} · +${RULES.killPoints}`, 'slain', 'ELIMINATION', 2000], voice, vol: .7, fallback: () => playKillSting(1) });
      else if (mineVictim) queueAnnouncement({ banner: ['DEFEATED', `${killer} đã hạ bạn`, 'slain enemy', 'ELIMINATION', 2000], voice, vol: .75, fallback: () => playKillSting(1, true) });   // an enemy killed me: red DEFEATED
      else if (ourSideScored) queueAnnouncement({ banner: ['SLAIN', `${killer} đã hạ ${victim}`, 'slain ally', 'ELIMINATION', 2000], voice, vol: .55, fallback: () => playKillSting(1) });   // my ally killed an enemy: blue SLAIN
      else queueAnnouncement({ banner: ['DEFEATED', `${killer} đã hạ ${victim}`, 'slain enemy', 'ELIMINATION', 2000], voice, vol: .75, fallback: () => playKillSting(1, true) });   // an enemy killed my ally: red SLAIN
    } else if (!special) {
      if (mineKiller) queueAnnouncement({ banner: ['SLAIN', `Bạn đã hạ ${victim} · +${RULES.killPoints}`, 'slain', 'ELIMINATION', 2000], voice: 'slain', vol: .7, fallback: () => playKillSting(1) });
      else if (victimSide !== 'enemy') queueAnnouncement({ ...(mineVictim ? { banner: ['DEFEATED', `${killer} đã hạ bạn`, 'slain enemy', 'ELIMINATION', 2000], fallback: () => playKillSting(1, true) } : {}), voice: 'defeated', vol: .75 });         // an enemy kills you (or your ally)
      else if (killerSide === 'ally') queueAnnouncement({ voice: 'slain', vol: .55 });              // your ally kills an enemy
      else queueAnnouncement({ banner: ['SLAIN', `${killer} đã hạ ${victim}`, 'slain enemy', 'ELIMINATION', 2000], voice: 'enemyDefeated', vol: .55, fallback: () => playKillSting(1) });   // enemy kills enemy -> red SLAIN banner + enemy_defeated.mp3
    }
    runAnnouncements();
  }

  function pushKillFeed({ killer, victim, tier, streakTier = 0, shutdown, points, mine, firstBlood }) {
    const root = $('kill-feed'); if (!root) return;
    const row = document.createElement('div');
    row.className = `kf-item${mine ? ' mine' : ''}`;
    const killerEl = document.createElement('span'); killerEl.className = 'kf-name'; killerEl.textContent = killer; killerEl.style.color = colorOfTank(killer);
    const icon = document.createElement('span'); icon.className = 'kf-icon'; icon.textContent = '⚔';
    const victimEl = document.createElement('span'); victimEl.className = 'kf-name'; victimEl.textContent = victim; victimEl.style.color = colorOfTank(victim);
    row.append(killerEl, icon, victimEl);
    if (firstBlood) { const tag = document.createElement('em'); tag.className = 'kf-tag shutdown'; tag.textContent = 'FIRST BLOOD'; row.append(tag); }
    if (tier >= 2) { const tag = document.createElement('em'); tag.className = 'kf-tag'; tag.textContent = MULTI_TITLES[tier]; row.append(tag); }
    if (streakTier) { const tag = document.createElement('em'); tag.className = 'kf-tag'; tag.textContent = STREAK_TITLES[streakTier]; row.append(tag); }
    if (shutdown) { const tag = document.createElement('em'); tag.className = 'kf-tag shutdown'; tag.textContent = 'SHUTDOWN'; row.append(tag); }
    const pts = document.createElement('span'); pts.className = 'kf-points'; pts.textContent = `+${points}`; row.append(pts);
    root.append(row);
    while (root.children.length > 12) root.firstElementChild.remove();
    setTimeout(() => row.remove(), mode === 'offline' && localGame && localGame.zone ? 2000 : 7000);   // control zone: the feed bar lasts only 2 s
  }

  function showKillBanner(title, subtitle, cls, kicker = 'ELIMINATION', ms = 2600) {
    const el = $('kill-banner'); if (!el) return;
    setText('kill-banner-title', title);
    setText('kill-banner-subtitle', subtitle);
    const kickerEl = el.querySelector('.kill-banner-kicker'); if (kickerEl) kickerEl.textContent = kicker;
    el.className = `kill-banner ${cls}`;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('kill-banner-pop');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  function showTabScoreboard(show) {
    tabHeld = show;
    const el = $('tab-scoreboard'); if (!el) return;
    el.hidden = !show;
    if (show && latestSnapshot) renderTabScoreboard(latestSnapshot);
  }

  function renderTabScoreboard(snapshot) {
    const body = $('tab-scoreboard-body'); if (!body) return;
    const entries = scoreboardEntries(snapshot);
    body.innerHTML = '';
    if (!entries.length) { body.innerHTML = '<tr><td colspan="6">Đang chờ dữ liệu…</td></tr>'; return; }
    entries.forEach(e => {
      const tr = document.createElement('tr'); if (isMe(e.id)) tr.className = 'me';
      const nameCell = document.createElement('td');
      const dot = document.createElement('span'); dot.className = 'tab-score-dot'; dot.style.color = COLORS[e.color] || '#c7f36b'; dot.style.background = 'currentColor';
      nameCell.append(dot, document.createTextNode(e.id + (isMe(e.id) ? ' (BẠN)' : '')));
      const status = !e.alive ? (e.team >= 0 ? 'ĐÃ HẠ' : `HỒI SINH ${e.respawn > 0 ? e.respawn.toFixed(1) + 's' : ''}`.trim()) : e.invuln > 0 ? 'BẤT TỬ' : 'SỐNG';
      [e.kills, e.deaths, e.points, e.streak, status].forEach(value => {
        const td = document.createElement('td'); td.textContent = String(value); tr.append(td);
      });
      tr.prepend(nameCell);
      body.append(tr);
    });
  }

  function showOverlay(title, text, buttonText, action) { $('overlay-title').textContent = title; $('overlay-text').textContent = text; $('overlay-action').textContent = buttonText; roundOverlayAction = action; $('arena-overlay').hidden = false; }
  function hideOverlay() { $('arena-overlay').hidden = true; roundOverlayAction = null; }

  // ---------------------------------------------------------------- input

  function getCurrentWorldDimensions() {
    return { w: WORLD_W, h: WORLD_H };
  }

  function updateCurrentInput() {
    if (mode !== 'online' || !wsReady || !loggedIn || screenName !== 'game') return;
    const snapshot = latestSnapshot; if (!snapshot) return;
    setMovementSound(input.up || input.down || input.left || input.right);
    const tanks = readField(snapshot, 'wsTanks') || []; const me = tanks.find(t => readField(t, 'tankId') === username) || tanks[0]; if (!me) return;
    const pos = readField(me, 'tankPos') || { vx: 0, vy: 0 };
    const pointer = localMap
      ? screenToLocalWorld(input.mouseX, input.mouseY)
      : { vx: input.mouseX, vy: input.mouseY };
    const angle = Math.atan2(pointer.vy - Number(readField(pos, 'vy') || 0), pointer.vx - Number(readField(pos, 'vx') || 0));
    sendMessage('CPlayerInput', { piMoveUp: input.up, piMoveDown: input.down, piMoveLeft: input.left, piMoveRight: input.right, piMouseAngle: angle, piFire: input.fire, piReload: input.reloadPulse });
    input.reloadPulse = false;
  }

  function startInputSender() { stopInputSender(); inputTimer = window.setInterval(updateCurrentInput, 1000 / 30); }
  function stopInputSender() { if (inputTimer !== null) { clearInterval(inputTimer); inputTimer = null; } }

  function setKey(key, pressed) {
    const k = key.toLowerCase();
    if (['w', 'arrowup'].includes(k)) input.up = pressed;
    else if (['s', 'arrowdown'].includes(k)) input.down = pressed;
    else if (['a', 'arrowleft'].includes(k)) input.left = pressed;
    else if (['d', 'arrowright'].includes(k)) input.right = pressed;
    else if (k === ' ' || k === 'space') input.fire = pressed;
  }
  function resetInput() {
    input.up = input.down = input.left = input.right = input.fire = false;
    input.reloadRequest = false;
    document.body.classList.remove('mouse-pressed');
    setMovementSound(false);
  }

  // R: reload the 6-round magazine. Offline uses the local simulator; online sends piReload to the server.
  function requestReload() {
    if (mode === 'offline') input.reloadRequest = true;
    else if (mode === 'online') input.reloadPulse = true;
  }

  document.addEventListener('keydown', e => {
    if (screenName !== 'game') return;
    if (e.key === 'Tab') { e.preventDefault(); if (!e.repeat) showTabScoreboard(true); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    if (e.key === 'Escape') { e.preventDefault(); togglePauseModal(); return; }
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) { if (!e.repeat && !isPaused) requestReload(); return; }
    setKey(e.key, true);
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'Tab') { showTabScoreboard(false); return; }
    setKey(e.key, false);
  });
  window.addEventListener('blur', () => { resetInput(); showTabScoreboard(false); });

  function pointerToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const dims = getCurrentWorldDimensions();
    input.mouseX = (clientX - rect.left) / rect.width * WORLD_W;
    input.mouseY = (clientY - rect.top) / rect.height * WORLD_H;
  }
  canvas.addEventListener('mousemove', e => pointerToWorld(e.clientX, e.clientY));
  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) { canvas.focus({ preventScroll: true }); input.fire = true; document.body.classList.add('mouse-pressed'); }
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) { input.fire = false; document.body.classList.remove('mouse-pressed'); } });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // Touch screen support for responsive mobile/tablet play
  function handleTouch(e) {
    if (!e.touches.length) return;
    pointerToWorld(e.touches[0].clientX, e.touches[0].clientY);
  }
  canvas.addEventListener('touchstart', e => { e.preventDefault(); handleTouch(e); input.fire = true; }, { passive: false });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); handleTouch(e); }, { passive: false });
  window.addEventListener('touchend', () => { input.fire = false; });

  // ---------------------------------------------------------------- pause / leave

  function showPauseModal() {
    if (screenName !== 'game') return;
    const modal = $('pause-modal');
    if (!modal) return;
    isPaused = true;
    updatePauseSoundLabel();
    modal.hidden = false;
  }
  function hidePauseModal() {
    const modal = $('pause-modal');
    isPaused = false;
    if (modal) modal.hidden = true;
  }
  function togglePauseModal() {
    if (screenName !== 'game') return;
    const modal = $('pause-modal');
    if (!modal) return;
    if (modal.hidden) showPauseModal();
    else hidePauseModal();
  }
  function updatePauseSoundLabel() {
    const label = $('pause-sound-label');
    if (label) label.textContent = soundEnabled ? 'ON' : 'OFF';
  }
  function leaveCurrentMatch() {
    hidePauseModal();
    hideOverlay();
    if (mode === 'online') {
      // SRoomLeft from the server moves the player back to the lobby.
      if (activeRoom) sendMessage('CLeaveRoom');
      else showScreen('lobby');
    } else {
      setMovementSound(false);
      leaveGameplayFullscreen();
      localGame = null;
      localMap = null;
      mode = 'none';
      showScreen('home');
    }
  }

  function quitGame() {
    window.close();
    window.setTimeout(() => { if (!window.closed) window.location.replace('about:blank'); }, 120);
  }

  // ---------------------------------------------------------------- canvas sizing

  // Keep layout responsive by sizing the canvas backing buffer to the screen resolution.
  function resizeCanvasBacking() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dims = getCurrentWorldDimensions();
    const targetW = Math.max(dims.w, Math.round(rect.width * dpr));
    const targetH = Math.max(dims.h, Math.round(rect.height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
  }
  window.addEventListener('resize', resizeCanvasBacking);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvasBacking, 100));

  // ---------------------------------------------------------------- event wiring (each handler registered once)

  $('online-button').addEventListener('click', connectOnline);
  $('player-name').addEventListener('keydown', e => { if (e.key === 'Enter') connectOnline(); });
  $('server-url').addEventListener('keydown', e => { if (e.key === 'Enter') connectOnline(); });
  $('main-exit').addEventListener('click', quitGame);

  // Matchmaking & Category dropdown wiring
  document.querySelectorAll('[data-match-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      setMatchCategory(btn.dataset.matchCategory);
      closeSetupMenus();
    });
  });
  const mmStartBtn = $('mm-start-btn');
  if (mmStartBtn) mmStartBtn.addEventListener('click', () => startMatchmaking(preferredMatchMap || 'random'));
  const mmCancelBtn = $('mm-cancel-btn');
  if (mmCancelBtn) mmCancelBtn.addEventListener('click', cancelMatchmaking);

  $('map-back').addEventListener('click', () => {
    cancelMatchmaking();
    if (mapSelectMode === 'online' && activeRoom) { showScreen('room'); return; }
    showScreen('home');
  });
  const MATCH_TIME_LIMITS = [1, 20];   // minutes allowed in the free-form box (free-for-all match)
  const TEAM_TIME_LIMITS = [1, 20];    // minutes allowed in the free-form box (one team round)
  const MATCH_CHOICES = [180, 300, 420, 600];        // free-for-all: 3 / 5 / 7 / 10 minutes
  const TEAM_ROUND_CHOICES = [90, 120, 180, 300];    // team mode, per round: 1:30 / 2 / 3 / 5 minutes
  function refreshBotSetup() {
    if (isMatchmakingSearching) cancelMatchmaking();
    updateMatchmakingModeDisplay();
    syncOfflineMapChoices();
    document.querySelectorAll('[data-difficulty]').forEach(button => button.classList.toggle('active', button.dataset.difficulty === botSettings.difficulty));
    document.querySelectorAll('[data-bots]').forEach(button => button.classList.toggle('active', Number(button.dataset.bots) === botSettings.bots));
    document.querySelectorAll('[data-team]').forEach(button => button.classList.toggle('active', Number(button.dataset.team) === botSettings.teamSize && !botSettings.zone));
    document.querySelectorAll('[data-zone]').forEach(button => button.classList.toggle('active', !!botSettings.zone && Number(button.dataset.zone) === botSettings.teamSize));
    const team = botSettings.teamSize >= 2, size = botSettings.teamSize, zone = team && !!botSettings.zone;
    const setTrigger = (id, text, active) => { const el = $(id); if (!el) return; el.textContent = text; const btn = el.closest('.setup-dd-trigger'); if (btn) btn.classList.toggle('active', active); };
    setTrigger('dd-team-label', team && !zone ? `ĐẤU ĐỘI · ${size}V${size}` : 'ĐẤU ĐỘI', team && !zone);
    setTrigger('dd-zone-label', zone ? `CẤM ĐỊA · ${size}V${size}` : 'CẤM ĐỊA', zone);
    setTrigger('dd-bots-label', `${botSettings.bots} BOT`, false);
    const timeGroup = $('setup-time-group'); if (timeGroup) timeGroup.hidden = zone;   // the zone mode has its own length
    const botsGroup = $('setup-bots-group'); if (botsGroup) botsGroup.hidden = team;
    // Match length: whole match in free-for-all, length of each round in team mode.
    const timeOptions = team ? TEAM_ROUND_CHOICES : MATCH_CHOICES, current = team ? botSettings.teamRoundSeconds : botSettings.matchSeconds;
    setText('setup-time-label', team ? 'THỜI GIAN MỖI ROUND' : 'THỜI GIAN TRẬN');
    const timeRoot = $('setup-time-options');
    if (timeRoot) {
      timeRoot.innerHTML = '';
      timeOptions.forEach(seconds => {
        const chip = document.createElement('button');
        chip.type = 'button'; chip.className = `setup-dd-item${seconds === current ? ' active' : ''}`; chip.dataset.seconds = String(seconds);
        chip.textContent = seconds % 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds / 60} PHÚT`;
        chip.addEventListener('click', () => { if (botSettings.teamSize >= 2) botSettings.teamRoundSeconds = seconds; else botSettings.matchSeconds = seconds; refreshBotSetup(); });
        timeRoot.append(chip);
      });
    }
    setText('dd-time-label', current % 60 ? `${Math.floor(current / 60)}:${String(Math.round(current % 60)).padStart(2, '0')}` : `${current / 60} PHÚT`);
    const roundsGroup = $('setup-rounds-group');
    if (roundsGroup) {
      roundsGroup.hidden = !team || zone;
      const roundsRoot = $('setup-rounds-options');
      if (team && !zone && roundsRoot) {
        roundsRoot.innerHTML = '';
        [3, 5, 7, 9].forEach(n => {
          const chip = document.createElement('button');
          chip.type = 'button'; chip.className = `setup-chip${n === botSettings.teamRounds ? ' active' : ''}`; chip.dataset.rounds = String(n); chip.textContent = String(n);
          chip.addEventListener('click', () => { botSettings.teamRounds = n; refreshBotSetup(); });
          roundsRoot.append(chip);
        });
        const roundsInput = $('setup-rounds-input');
        if (roundsInput && document.activeElement !== roundsInput) roundsInput.value = String(botSettings.teamRounds);
        setText('setup-rounds-need', `THẮNG KHI ĐẠT ${Math.floor(botSettings.teamRounds / 2) + 1} ROUND`);
      }
    }
    const timeInput = $('setup-time-input');
    if (timeInput) {
      const [lo, hi] = team ? TEAM_TIME_LIMITS : MATCH_TIME_LIMITS;
      timeInput.min = String(lo); timeInput.max = String(hi);
      if (document.activeElement !== timeInput) timeInput.value = String(Math.round(current / 60 * 100) / 100);   // don't overwrite while typing
    }
    const botsInput = $('setup-bots-input'); if (botsInput && document.activeElement !== botsInput) botsInput.value = String(botSettings.bots);
    setText('setup-hint', zone
      ? `CẤM ĐỊA ${size}V${size}: Hai đội tranh giành quyền kiểm soát khu vực trung tâm bản đồ rộng hơn trước. Trong ${RULES.zoneLockSeconds} giây đầu, khu vực bị khóa chiếm điểm nhưng hai đội vẫn có thể giao tranh bình thường. Khi khu vực mở, đội có nhiều xe tăng bên trong hơn sẽ chiếm ưu thế và đẩy thanh tiến trình về phía mình; nếu số xe hai đội bằng nhau, tiến trình sẽ tạm dừng. Đội đạt 100% trước sẽ giành chiến thắng. Khi cả hai đội cùng chạm 99%, đội có nhiều xe hơn trong vùng liên tục ${RULES.zoneContestSeconds} giây sẽ thắng; thanh vàng reset ngay nếu số xe bằng nhau hoặc đội đang áp đảo rời vùng. Xe bị hạ gục sẽ hồi sinh sau ${RULES.zoneRespawn} giây và mỗi xe chỉ có thể bắn một phát sau mỗi ${RULES.zoneShotDelay} giây. ${BOT_LEVELS[botSettings.difficulty].hint}`
      : team
        ? `${size}V${size}: Bạn cùng ${size - 1} bot đồng đội (xanh) đối đầu với ${size} bot địch (đỏ). Trận đấu gồm ${botSettings.teamRounds} ván; đội thắng ${Math.floor(botSettings.teamRounds / 2) + 1} ván trước sẽ thắng cả trận. Mỗi ván là một trận tử chiến: xe bị hạ sẽ không thể quay lại cho đến ván tiếp theo. Đội bị tiêu diệt toàn bộ sẽ thua ván đó. Kết thúc các ván, đội thắng nhiều ván hơn sẽ giành chiến thắng chung cuộc. ${BOT_LEVELS[botSettings.difficulty].hint}`
        : BOT_LEVELS[botSettings.difficulty].hint);
    syncOfflineMapChoices();
  }
  (function bindRoundsInput() {
    const input = $('setup-rounds-input'); if (!input) return;
    const apply = final => {
      const n = parseInt(input.value, 10);
      if (!Number.isFinite(n)) { if (final) refreshBotSetup(); return; }
      if (!final && (n < 1 || n > 20)) return;   // wait until the typed value is valid
      botSettings.teamRounds = clamp(n, 1, 20);
      setText('setup-rounds-need', `THẮNG KHI ĐẠT ${Math.floor(botSettings.teamRounds / 2) + 1} ROUND`);
      document.querySelectorAll('#setup-rounds-options .setup-chip').forEach(chip => chip.classList.toggle('active', Number(chip.dataset.rounds) === botSettings.teamRounds));
      if (final) { input.blur(); refreshBotSetup(); }
    };
    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => apply(true));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(true); } e.stopPropagation(); });
  })();
  (function bindTimeInput() {
    const input = $('setup-time-input'); if (!input) return;
    const apply = final => {
      const team = botSettings.teamSize >= 2, [lo, hi] = team ? TEAM_TIME_LIMITS : MATCH_TIME_LIMITS;
      const minutes = parseFloat(String(input.value).replace(',', '.'));
      if (!Number.isFinite(minutes)) { if (final) refreshBotSetup(); return; }
      if (!final && (minutes < lo || minutes > hi)) return;   // wait until the typed value is valid
      const seconds = Math.round(clamp(minutes, lo, hi) * 60);
      if (team) botSettings.teamRoundSeconds = seconds; else botSettings.matchSeconds = seconds;
      if (final) { input.blur(); closeSetupMenus(); }
      document.querySelectorAll('#setup-time-options .setup-dd-item').forEach(chip => chip.classList.toggle('active', Number(chip.dataset.seconds) === seconds));
      if (final) refreshBotSetup();
    };
    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => apply(true));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(true); } e.stopPropagation(); });
  })();
  // ---- drop-down menus of the setup panel (mode, bots, time) ----
  function closeSetupMenus() {
    document.querySelectorAll('.setup-dd').forEach(dd => {
      const menu = dd.querySelector('.setup-dd-menu'), trigger = dd.querySelector('.setup-dd-trigger');
      if (menu) menu.hidden = true;
      dd.classList.remove('open');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }
  document.querySelectorAll('.setup-dd').forEach(dd => {
    const menu = dd.querySelector('.setup-dd-menu'), trigger = dd.querySelector('.setup-dd-trigger');
    if (!menu || !trigger) return;
    trigger.addEventListener('click', () => {
      const wasClosed = menu.hidden;
      closeSetupMenus();
      if (wasClosed) { menu.hidden = false; dd.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); }
    });
    menu.addEventListener('click', e => { if (e.target.closest('.setup-dd-item')) closeSetupMenus(); });
  });
  document.addEventListener('click', e => { if (!e.target.closest('.setup-dd')) closeSetupMenus(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSetupMenus(); });
  (function bindBotsInput() {
    const input = $('setup-bots-input'); if (!input) return;
    const apply = final => {
      const n = parseInt(input.value, 10);
      if (!Number.isFinite(n)) { if (final) refreshBotSetup(); return; }
      if (!final && (n < 1 || n > MAX_BOTS)) return;   // wait until the typed value is valid
      botSettings.bots = clamp(n, 1, MAX_BOTS);
      if (final) { input.blur(); closeSetupMenus(); refreshBotSetup(); return; }
      setText('dd-bots-label', `${botSettings.bots} BOT`);
      document.querySelectorAll('[data-bots]').forEach(button => button.classList.toggle('active', Number(button.dataset.bots) === botSettings.bots));
    };
    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => apply(true));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(true); } e.stopPropagation(); });
  })();
  document.querySelectorAll('[data-difficulty]').forEach(button => button.addEventListener('click', () => {
    if (BOT_LEVELS[button.dataset.difficulty]) botSettings.difficulty = button.dataset.difficulty;
    refreshBotSetup();
  }));
  document.querySelectorAll('[data-bots]').forEach(button => button.addEventListener('click', () => {
    botSettings.bots = Math.max(1, Math.min(MAX_BOTS, Number(button.dataset.bots) || 3));
    refreshBotSetup();
  }));
  document.querySelectorAll('[data-zone]').forEach(button => button.addEventListener('click', () => {
    botSettings.zone = true;
    botSettings.teamSize = Math.max(2, Math.min(5, Number(button.dataset.zone) || 3));
    refreshBotSetup();
  }));
  document.querySelectorAll('[data-team]').forEach(button => button.addEventListener('click', () => {
    botSettings.zone = false;
    botSettings.teamSize = Math.max(0, Math.min(5, Number(button.dataset.team) || 0));
    refreshBotSetup();
  }));
  document.querySelectorAll('[data-map]').forEach(button => button.addEventListener('click', () => {
    if (mapSelectMode === 'online') chooseOnlineMap(button.dataset.map);
    else chooseOfflineMap(button.dataset.map);
  }));
  $('online-team-blue').addEventListener('click', () => {
    if (mapSelectMode === 'online' && onlineDraft.mode === 'teams') {
      onlineDraft.teams = { ...onlineDraft.teams, [username]: 'blue' };
      renderOnlineMatchSetup();
      sendMessage('CChooseTeam', { cctTeam: 'blue' });
    }
  });
  $('online-team-red').addEventListener('click', () => {
    if (mapSelectMode === 'online' && onlineDraft.mode === 'teams') {
      onlineDraft.teams = { ...onlineDraft.teams, [username]: 'red' };
      renderOnlineMatchSetup();
      sendMessage('CChooseTeam', { cctTeam: 'red' });
    }
  });
  $('online-start-match').addEventListener('click', () => {
    if (!isHost) return;
    const players = onlineDraft.players.length ? onlineDraft.players : roomPlayerNames.map(player => player.name).filter(Boolean);
    if (!getOnlineDraftReadiness(players).ready) { setError('map-error', 'CÁC NGƯỜI CHƠI CHƯA SẴN SÀNG. Mỗi người phải chọn đội và bản đồ.'); return; }
    setError('map-error', '');
    sendMessage('CStartGame');
  });
  $('tank-select-back').addEventListener('click', closeTankSelect);
  $('tank-confirm').addEventListener('click', confirmTankSelection);
  document.querySelectorAll('[data-hull]').forEach(button => button.addEventListener('click', () => {
    selectedHullId = button.dataset.hull || '05';
    refreshTankAssembly();
  }));
  document.querySelectorAll('[data-gun]').forEach(button => button.addEventListener('click', () => {
    selectedGunId = button.dataset.gun || '05';
    refreshTankAssembly();
  }));
  $('results-exit').addEventListener('click', exitResultsToHome);
  $('results-back').addEventListener('click', backToBattleRoom);
  $('brand-home').addEventListener('click', e => {
    e.preventDefault();
    if (screenName === 'game') { togglePauseModal(); return; }
    if (ws || mode === 'online') closeSocket();
    mode = 'none';
    showScreen('home');
  });
  $('practice-button').addEventListener('click', () => openTankSelect('offline'));
  $('create-button').addEventListener('click', createRoom);
  $('room-mode').addEventListener('change', syncCustomRoomPlayerOptions);
  $('max-players').addEventListener('change', syncCustomRoomPlayerOptions);
  syncCustomRoomPlayerOptions();
  $('join-button').addEventListener('click', joinRoom);
  $('join-id').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
  $('join-id').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  $('start-button').addEventListener('click', () => {
    unlockAudio(); setError('lobby-error', '');
    if (!isHost) { setError('lobby-error', 'Chỉ chủ phòng mới có thể bắt đầu.'); return; }
    // This begins the online pre-match flow; it never starts a local practice
    // arena. The server asks every member to choose a tank, then map voting.
    sendMessage('COpenDraft');
    openTankSelect('onlineMap');
  });
  $('leave-room').addEventListener('click', () => { if (wsReady && activeRoom) sendMessage('CLeaveRoom'); else { activeRoom = null; showScreen('lobby'); } });
  $('lobby-back').addEventListener('click', () => { if (activeRoom) sendMessage('CLeaveRoom'); else { closeSocket(); showScreen('home'); } });
  $('copy-room-code').addEventListener('click', async () => {
    const code = $('room-code').textContent;
    try { await navigator.clipboard.writeText(code); $('copy-room-code').textContent = '✓'; setTimeout(() => $('copy-room-code').textContent = '⧉', 900); }
    catch (_) { $('join-id').value = code; }
  });
  $('overlay-action').addEventListener('click', () => { const action = roundOverlayAction; hideOverlay(); if (action) action(); });
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') document.body.classList.add('mouse-pressed');
  });
  window.addEventListener('pointerup', () => document.body.classList.remove('mouse-pressed'));
  window.addEventListener('blur', () => document.body.classList.remove('mouse-pressed'));
  document.addEventListener('keydown', unlockAudio, { once: true });
  document.addEventListener('click', event => { if (event.target.closest('button') && event.target.closest('#sound-toggle') === null) playSfx('click', .24); });
  $('sound-toggle').addEventListener('click', toggleSound);
  $('pause-open-btn')?.addEventListener('click', togglePauseModal);
  $('pause-resume-btn')?.addEventListener('click', hidePauseModal);
  $('pause-leave-btn')?.addEventListener('click', leaveCurrentMatch);
  $('pause-sound-btn')?.addEventListener('click', toggleSound);
  $('pause-fullscreen-btn')?.addEventListener('click', () => {
    if (!document.fullscreenElement) enterGameplayFullscreen(); else leaveGameplayFullscreen();
  });
  $('exit-game')?.addEventListener('click', togglePauseModal);

  const fullscreenBtn = $('fullscreen-button');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) enterGameplayFullscreen(); else leaveGameplayFullscreen();
    });
    document.addEventListener('fullscreenchange', () => {
      fullscreenBtn.textContent = document.fullscreenElement ? 'THU NHỎ 🗗' : '⛶ TOÀN MÀN HÌNH';
      setTimeout(resizeCanvasBacking, 60);
    });
  }

  const volumeSlider = $('pause-volume');
  if (volumeSlider) {
    volumeSlider.value = '100';
    const applyVolume = () => {
      musicScale = Number(volumeSlider.value) / 100;
      setText('pause-volume-value', `${volumeSlider.value}%`);
      applyMusicVolume();
    };
    volumeSlider.addEventListener('input', applyVolume);
    applyVolume();
  }

  // Small defaults are remembered locally for the next session.
  $('player-name').value = localStorage.getItem('tankwar-name') || '';
  const pageProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const pageHost = window.location.hostname || 'localhost';
  // Local static development servers use a separate game server on port 8081.
  const staticDevPorts = new Set(['4173', '5173', '8080']);
  const isLocalHost = pageHost === 'localhost' || pageHost === '127.0.0.1' || pageHost === '[::1]';
  // Production bundles the site and socket behind one HTTPS origin. This
  // avoids a mixed-content error and makes the public game URL shareable.
  // Local development still connects directly to the Haskell server.
  const defaultWsUrl = isLocalHost && staticDevPorts.has(window.location.port)
    ? `${pageProtocol}//${pageHost}:8081`
    : `${pageProtocol}//${window.location.host}/ws`;
  const savedServer = localStorage.getItem('tankwar-server');
  // Static Web servers commonly run on 5173; do not default WebSocket traffic to that port.
  const invalidSavedDefaults = [
    'ws://localhost:8081', 'ws://127.0.0.1:8081', 'wss://localhost:8081', 'wss://127.0.0.1:8081',
    'ws://localhost:5173', 'ws://127.0.0.1:5173', 'wss://localhost:5173', 'wss://127.0.0.1:5173',
    'ws://localhost:8080', 'ws://127.0.0.1:8080', 'wss://localhost:8080', 'wss://127.0.0.1:8080',
    'ws://localhost:3000', 'ws://127.0.0.1:3000', 'wss://localhost:3000', 'wss://127.0.0.1:3000'
  ];
  $('server-url').value = savedServer && !invalidSavedDefaults.includes(savedServer)
    ? savedServer
    : defaultWsUrl;
  refreshBotSetup();
  refreshTankAssembly();
  refreshSoundToggle();
  statusPill('idle', 'SẴN SÀNG KẾT NỐI');
  resetConnectButton();
  resizeCanvasBacking();

  // Expose a small protocol diagnostic through the console for coursework debugging.
  window.TankWarClient = { get mode() { return mode; }, get connected() { return wsReady; }, get room() { return activeRoom; }, send: sendMessage };
})();
